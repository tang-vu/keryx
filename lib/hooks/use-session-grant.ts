"use client";

/**
 * useSessionGrant — manages the browser-side session key lifecycle.
 *
 * Flow:
 *   1. generateAndFund()  — generates an ephemeral EOA (key in memory only), prompts the
 *      user to send one MetaMask tx to fund it, then calls gateway.deposit() from the browser,
 *      then POSTs to /api/session/grant to register it server-side.
 *   2. The session key is held in a React ref (tab memory only) and also backed up in
 *      sessionStorage as hex (tab-scoped, never persists to disk after tab close).
 *   3. revoke()           — drops the server grant and prepares on-chain Gateway withdraw data.
 *      The caller (GrantSpendDialog) performs the actual withdraw via wagmi writeContract.
 *
 * Key derivation (funds are never lost):
 *   The session key is NOT random — it is derived deterministically from a signature
 *   of a fixed message by the user's main wallet: sk = keccak256(sign(DERIVE_MESSAGE)).
 *   Same wallet + same message → same key on ANY device/browser. So a closed tab,
 *   a sign-out, or a different machine never orphans the funded session EOA: signing
 *   the message again reproduces the exact same key, and the Gateway balance under it
 *   can be resumed or withdrawn. recoverViaSignature() does exactly this.
 *
 * SECURITY:
 *   - The private key NEVER leaves the browser — it is never sent to any server endpoint.
 *     The server only ever sees the derived public address.
 *   - sessionStorage is the tab-scoped fast path for same-tab reloads; cross-tab /
 *     cross-device recovery is via one wallet signature (no key persisted to disk).
 *   - XSS can exfiltrate the key up to the funded cap, not the user's whole wallet.
 *     Mitigations: strict CSP, small funded amounts, short TTL (1h default).
 *   - Determinism relies on RFC-6979 deterministic ECDSA (MetaMask/Rabby/Ledger/Coinbase).
 *     A wallet that signs non-deterministically simply can't recover (credit lookup
 *     returns nothing) — it never loses MORE funds, it just can't auto-resume.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import { createWalletClient, http, parseUnits, parseEther, erc20Abi, keccak256, type WalletClient } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config as kConfig } from "@/lib/config";

const SESSION_KEY_STORAGE = "keryx_session_sk";
const SESSION_ADDR_STORAGE = "keryx_session_addr";
const SESSION_ID_STORAGE = "keryx_session_id";
// Timestamp marker: "a deposit was made and is waiting for Circle Gateway to credit".
// Lets a reload during confirmation auto-resume polling instead of dead-ending.
const SESSION_PENDING_STORAGE = "keryx_session_pending";
const PENDING_TTL_MS = 15 * 60 * 1000; // a pending deposit older than this is stale

// Extra native USDC sent to the session EOA on top of the funded budget so it can
// pay gas for its own approve + Gateway-deposit txs (Arc gas is tiny). Leftover stays
// in the session EOA and is recoverable via the derived key.
const SESSION_GAS_BUFFER_USDC = 0.01;

// Fixed message signed to derive the session key. MUST stay byte-for-byte constant
// across releases — changing it would derive a different key and "lose" access to
// existing funded sessions. Versioned so a deliberate rotation is explicit.
const DERIVE_MESSAGE =
  "Keryx spending session key v1\n\n" +
  "Sign to derive your in-browser spending session. This is NOT a transaction and " +
  "costs no gas. Signing the same message always recreates the same session, so your " +
  "funds are never lost. Only sign this on keryx.cc.";

export type GrantStatus =
  | "idle"
  | "switching"        // prompting the wallet to switch to Arc Testnet
  | "generating"
  | "funding"          // waiting for MetaMask fund tx
  | "depositing"       // session EOA approve + Gateway deposit txs
  | "confirming"       // waiting for Circle Gateway to reflect the credit (off-chain lag)
  | "registering"      // POSTing to /api/session/grant
  | "recovering"       // re-deriving key from a signature to resume a funded session
  | "active"
  | "expired"          // grant TTL lapsed — funds safe in the Gateway; recover to resume
  | "revoking"
  | "revoked"
  | "error";

export interface GrantState {
  status: GrantStatus;
  sessAddr: string | null;
  sessionId: string | null;
  cap: number;
  spent: number;
  expiresAt: string | null;
  error: string | null;
}

const INITIAL: GrantState = {
  status: "idle",
  sessAddr: null,
  sessionId: null,
  cap: 0,
  spent: 0,
  expiresAt: null,
  error: null,
};

// Type aliases used by both the hook and the helper functions.
type SessionWalletClient = ReturnType<typeof createWalletClient>;
type SessionPublicClient = NonNullable<ReturnType<typeof usePublicClient>>;

/**
 * Recover a session key from sessionStorage on tab reload.
 * Returns null when nothing was saved or the tab is fresh.
 */
function recoverFromStorage(): { sk: `0x${string}`; sessAddr: string; sessionId: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const sk = sessionStorage.getItem(SESSION_KEY_STORAGE) as `0x${string}` | null;
    const sessAddr = sessionStorage.getItem(SESSION_ADDR_STORAGE);
    const sessionId = sessionStorage.getItem(SESSION_ID_STORAGE);
    if (!sk || !sessAddr || !sessionId) return null;
    return { sk, sessAddr, sessionId };
  } catch {
    return null;
  }
}

/**
 * Derive the session private key from a wallet signature of the fixed DERIVE_MESSAGE.
 * Deterministic: same wallet → same signature (RFC-6979) → same key, on any device.
 * keccak256 of the signature is a uniformly-distributed 32-byte value — a valid
 * secp256k1 private key for all practical purposes.
 */
async function deriveSessionKey(walletClient: WalletClient): Promise<`0x${string}`> {
  const signature = await walletClient.signMessage({
    account: walletClient.account!,
    message: DERIVE_MESSAGE,
  });
  return keccak256(signature);
}

function saveToStorage(sk: string, sessAddr: string, sessionId: string) {
  try {
    sessionStorage.setItem(SESSION_KEY_STORAGE, sk);
    sessionStorage.setItem(SESSION_ADDR_STORAGE, sessAddr);
    sessionStorage.setItem(SESSION_ID_STORAGE, sessionId);
  } catch { /* storage full or private mode — non-fatal */ }
}

function clearStorage() {
  try {
    sessionStorage.removeItem(SESSION_KEY_STORAGE);
    sessionStorage.removeItem(SESSION_ADDR_STORAGE);
    sessionStorage.removeItem(SESSION_ID_STORAGE);
    sessionStorage.removeItem(SESSION_PENDING_STORAGE);
  } catch { /* ignore */ }
}

function markPending() {
  try { sessionStorage.setItem(SESSION_PENDING_STORAGE, String(Date.now())); } catch { /* ignore */ }
}
function clearPending() {
  try { sessionStorage.removeItem(SESSION_PENDING_STORAGE); } catch { /* ignore */ }
}
/** True when a deposit is pending credit confirmation and not yet stale. */
function isPendingFresh(): boolean {
  try {
    const t = Number(sessionStorage.getItem(SESSION_PENDING_STORAGE) ?? "0");
    return t > 0 && Date.now() - t < PENDING_TTL_MS;
  } catch {
    return false;
  }
}

export function useSessionGrant() {
  const [state, setState] = useState<GrantState>(INITIAL);
  // The session private key lives ONLY in this ref (and sessionStorage for reload recovery).
  const skRef = useRef<`0x${string}` | null>(null);

  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  /**
   * Ensure the connected wallet is on Arc Testnet before any tx. If it isn't,
   * sendTransaction({chain: arcTestnet}) would silently wait for a network switch
   * the user never sees prompted — the "Waiting for USDC transfer…" hang. Prompting
   * the switch explicitly surfaces it (and adds Arc via EIP-3085 if unknown).
   */
  const ensureArc = useCallback(async () => {
    if (walletClient && walletClient.chain?.id !== arcTestnet.id) {
      await switchChainAsync({ chainId: arcTestnet.id });
    }
  }, [walletClient, switchChainAsync]);

  /**
   * Shared resume core: given the session key, read the live Gateway balance under its
   * (deterministic) address, re-register the grant in recover mode with cap = that real
   * balance, and mark the session active. Returns false when the Gateway shows nothing
   * yet (deposit still confirming, or empty) — callers decide the messaging, and the
   * session is NEVER shown active against a zero balance (which would fail Circle's verify).
   * Re-registering also restores a grant the server lost on restart, so a deploy never
   * strands an active session.
   */
  const resumeFromKey = useCallback(async (sk: `0x${string}`): Promise<boolean> => {
    const sessAddr = privateKeyToAccount(sk).address;
    let residualUsdc = 0;
    try {
      const r = await fetch(`/api/session/credit?address=${encodeURIComponent(sessAddr)}`);
      const c = (await r.json().catch(() => ({}))) as { available?: string };
      residualUsdc = Number(BigInt(c.available ?? "0")) / 1e6;
    } catch {
      return false;
    }
    if (residualUsdc <= 0) return false;

    skRef.current = sk;
    const res = await fetch("/api/session/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessAddr, budget: residualUsdc, recover: true }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(error ?? "grant registration failed");
    }
    const { sessionId, expiresAt } = (await res.json()) as { sessionId: string; expiresAt: string };
    saveToStorage(sk, sessAddr, sessionId);
    clearPending(); // credit confirmed → no longer waiting
    setState({ status: "active", sessAddr, sessionId, cap: residualUsdc, spent: 0, expiresAt, error: null });
    return true;
  }, []);

  /** Auto-restore on reload (called on mount by the dialog). Uses the key cached in
   *  sessionStorage — no signature. Activates when the Gateway balance is real; if a
   *  deposit is still pending (credit not yet reflected), enters the "confirming" state
   *  so the background poller below auto-activates it without any user action. */
  const tryRecover = useCallback(async () => {
    const saved = recoverFromStorage();
    if (!saved) return false;
    try {
      if (await resumeFromKey(saved.sk)) return true;
    } catch {
      // Re-register failed (transient) — fall through to the pending path.
    }
    if (isPendingFresh()) {
      skRef.current = saved.sk;
      setState((s) => ({ ...s, status: "confirming", sessAddr: saved.sessAddr }));
      return true;
    }
    return false;
  }, [resumeFromKey]);

  // Background auto-resume: while a deposit is confirming, poll the Gateway every few
  // seconds and flip to "active" the moment the credit lands — no button, no timeout
  // dead-end. Gives up only after ~8 min with a calm (non-scary) note; the funds stay
  // safe on-chain and a later visit auto-resumes via tryRecover + the pending marker.
  useEffect(() => {
    if (state.status !== "confirming") return;
    let cancelled = false;
    let tries = 0;
    const id = setInterval(async () => {
      if (cancelled) return;
      tries++;
      const sk = skRef.current;
      if (sk) {
        try {
          if (await resumeFromKey(sk)) return; // success → status flips → effect cleans up
        } catch { /* transient — keep trying */ }
      }
      if (tries >= 96) {
        clearInterval(id);
        setState((s) =>
          s.status === "confirming"
            ? {
                ...s,
                status: "error",
                error:
                  "Deposit is still confirming on Circle Gateway. Your funds are safe — reopen this page in a few minutes and it resumes automatically.",
              }
            : s,
        );
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state.status, resumeFromKey]);

  /**
   * Flip an active session to "expired" when its server-side grant TTL lapses.
   * The session key and the Gateway balance are untouched — recovery (a reload
   * auto-recovers via tryRecover, or one signature via recoverViaSignature)
   * re-registers a fresh grant. Idempotent: only acts on an active session.
   */
  const markExpired = useCallback(() => {
    setState((s) => (s.status === "active" ? { ...s, status: "expired" } : s));
  }, []);

  // Client-side expiry timer. The server drops the grant at its TTL, but nothing
  // client-side notices until the next request — which would then silently fall back
  // to the treasury gateway. Arm a timer for expiresAt so the UI flips to "expired"
  // (surfacing the recover prompt) the moment the grant lapses, instead of looking
  // active while the server has already forgotten it.
  useEffect(() => {
    if (state.status !== "active" || !state.expiresAt) return;
    // Always schedule via a timer (clamped to >= 0) so an already-past expiry flips on
    // the next tick rather than calling setState synchronously inside the effect body.
    const ms = Math.max(0, new Date(state.expiresAt).getTime() - Date.now());
    const id = setTimeout(markExpired, ms);
    return () => clearTimeout(id);
  }, [state.status, state.expiresAt, markExpired]);

  /**
   * Full grant flow: generate key → fund EOA → deposit to Gateway → register grant.
   * budgetUsdc is the total USDC the user wants to fund into the session.
   */
  const generateAndFund = useCallback(
    async (budgetUsdc: number) => {
      if (!walletClient || !publicClient) {
        setState((s) => ({ ...s, status: "error", error: "Wallet not connected — connect MetaMask first" }));
        return;
      }
      // Narrow publicClient type for use in depositToGateway (usePublicClient can return undefined).
      const pc = publicClient as SessionPublicClient;

      try {
        // 0. Make sure the wallet is on Arc before any tx — otherwise the funding
        //    sendTransaction silently waits on a network switch and looks hung.
        setState({ ...INITIAL, status: "switching" });
        await ensureArc();

        setState((s) => ({ ...s, status: "generating" }));
        // 1. Derive the session key from a wallet signature (NOT random) — never
        //    leaves the browser. Deterministic, so the funded EOA can always be
        //    reproduced on any device by signing the same message again.
        const sk = await deriveSessionKey(walletClient);
        const sessAccount = privateKeyToAccount(sk);
        const sessAddr = sessAccount.address;
        skRef.current = sk;
        // Persist the key BEFORE funding so a reload mid-flow can recover via the
        // Gateway balance instead of losing the in-progress session. sessionId here is
        // the connected address (what the server uses); the authoritative value from
        // the grant response overwrites it at the end.
        saveToStorage(sk, sessAddr, walletClient.account!.address.toLowerCase());

        setState((s) => ({ ...s, status: "funding", sessAddr }));

        // 2. One MetaMask tx: move USDC to the session EOA. On Arc, USDC IS the
        //    native gas token — an ERC-20 transfer() between EOAs on the 0x3600
        //    interface reverts (and MetaMask's failed gas-estimate can hang), so we
        //    send a NATIVE value transfer (18-decimal) instead — the same fix the
        //    faucet uses. We send budget + a small buffer so the session EOA can pay
        //    the gas for its own approve+deposit; the leftover is recoverable.
        // NOTE: do NOT pass `chain` here. ensureArc() already guaranteed the wallet is
        // on Arc; passing `chain` makes viem assert chainId against the (possibly stale)
        // injected client before sending, which can hang BEFORE MetaMask ever shows the
        // tx prompt — the "Waiting for USDC transfer…" no-popup hang. signMessage works
        // precisely because it takes no chain param. Send a plain native value transfer
        // (gas is exactly 21000 for an EOA→EOA value send).
        const usdcTx = await walletClient.sendTransaction({
          account: walletClient.account!,
          to: sessAddr,
          value: parseEther((budgetUsdc + SESSION_GAS_BUFFER_USDC).toFixed(18)),
          gas: BigInt(21000),
        });
        // Bound the wait so a stuck/dropped tx surfaces an error instead of spinning forever.
        const fundReceipt = await publicClient.waitForTransactionReceipt({
          hash: usdcTx,
          timeout: 90_000,
        });
        if (fundReceipt.status !== "success") {
          throw new Error("Funding transfer reverted on-chain — please try again.");
        }

        setState((s) => ({ ...s, status: "depositing" }));

        // 3. Browser-side Gateway deposit from the session key.
        //    Build a proper viem WalletClient for the session account with the Arc transport.
        const sessionWalletClient = createWalletClient({
          account: sessAccount,
          chain: arcTestnet,
          transport: http(kConfig.rpcUrl),
        });

        // The Gateway contract requires an ERC20 approve + a deposit call.
        // We replicate what RealGateway.ensureFunded does, but from the browser.
        await depositToGateway(sessionWalletClient, pc, budgetUsdc);

        // 4. Hand off to background confirmation. Circle's off-chain credit lags
        //    ~10-90s; rather than block the user (and dead-end on a timeout), mark the
        //    deposit pending and enter "confirming". The background poller above flips
        //    to "active" automatically the moment the credit lands — and a reload during
        //    this window auto-resumes via tryRecover. We must NOT activate before the
        //    credit is real, or the first ask would fail Circle's verify.
        markPending();
        setState((s) => ({ ...s, status: "confirming", sessAddr }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, status: "error", error: /reject|denied/i.test(message) ? "Network switch or signature was rejected." : message }));
      }
    },
    [walletClient, publicClient, ensureArc],
  );

  /**
   * Recover a funded session on a fresh tab / different browser / after sign-out.
   * Re-derives the key from a wallet signature (same wallet → same key), looks up
   * how much USDC remains in the Gateway under that session EOA, and re-registers
   * the server grant so the agent can resume spending. No funding tx needed.
   *
   * If the Gateway holds nothing under the derived address, there is nothing to
   * recover (or the wallet signs non-deterministically) — we say so, never silently
   * creating a new empty session.
   */
  const recoverViaSignature = useCallback(async () => {
    if (!walletClient) {
      setState((s) => ({ ...s, status: "error", error: "Connect your wallet first" }));
      return;
    }
    setState({ ...INITIAL, status: "recovering" });
    try {
      const sk = await deriveSessionKey(walletClient);
      const ok = await resumeFromKey(sk);
      if (!ok) {
        skRef.current = null;
        setState({
          ...INITIAL,
          status: "error",
          error: "No recoverable session found for this wallet (the deposit may still be confirming — try again shortly).",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({
        ...s,
        status: "error",
        error: /reject|denied/i.test(message) ? "Signature rejected" : message,
      }));
    }
  }, [walletClient, resumeFromKey]);

  /**
   * Add more USDC to the ACTIVE session: fund the existing session EOA with more
   * native USDC, deposit it into the Gateway, then re-register the grant with the new
   * (confirmed) total balance. No new key — reuses the deterministic session key.
   */
  const topUp = useCallback(
    async (addUsdc: number) => {
      const sk = skRef.current;
      if (!sk || !state.sessAddr || state.status !== "active") return;
      if (!walletClient || !publicClient) {
        setState((s) => ({ ...s, status: "error", error: "Wallet not connected" }));
        return;
      }
      const pc = publicClient as SessionPublicClient;
      const sessAddr = state.sessAddr as `0x${string}`;
      try {
        setState((s) => ({ ...s, status: "switching" }));
        await ensureArc();
        setState((s) => ({ ...s, status: "funding" }));
        // No `chain` param — see the note in generateAndFund (avoids the no-popup hang).
        const tx = await walletClient.sendTransaction({
          account: walletClient.account!,
          to: sessAddr,
          value: parseEther((addUsdc + SESSION_GAS_BUFFER_USDC).toFixed(18)),
          gas: BigInt(21000),
        });
        const rc = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
        if (rc.status !== "success") throw new Error("Top-up transfer reverted — please try again.");

        setState((s) => ({ ...s, status: "depositing" }));
        const sessionWalletClient = createWalletClient({
          account: privateKeyToAccount(sk),
          chain: arcTestnet,
          transport: http(kConfig.rpcUrl),
        });
        await depositToGateway(sessionWalletClient, pc, addUsdc);

        // Hand off to the background poller (same as the initial fund): it re-reads the
        // new total balance once Circle credits it and updates the active cap — no block,
        // no dead-end. cap stays at the old value until the top-up confirms.
        markPending();
        setState((s) => ({ ...s, status: "confirming" }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, status: "error", error: message }));
      }
    },
    [walletClient, publicClient, state.sessAddr, state.status, ensureArc],
  );

  /**
   * Revoke the server-side grant. Returns the residual USDC amount so the
   * caller can offer to withdraw it from the Gateway back to the user's wallet.
   * The on-chain withdraw itself must be done by the caller (GrantSpendDialog).
   */
  const revoke = useCallback(async (): Promise<{ residualUsdc: number; sessAddr: string | null }> => {
    setState((s) => ({ ...s, status: "revoking" }));
    try {
      const res = await fetch("/api/session/revoke", { method: "POST" });
      const data = await res.json().catch(() => ({})) as { residualUsdc?: number };
      const residualUsdc = data.residualUsdc ?? 0;
      const sessAddr = state.sessAddr;

      // Clear the session key from memory and storage.
      skRef.current = null;
      clearStorage();

      setState({ ...INITIAL, status: "revoked" });
      return { residualUsdc, sessAddr };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, status: "error", error: message }));
      return { residualUsdc: 0, sessAddr: state.sessAddr };
    }
  }, [state.sessAddr]);

  /**
   * Expose the session WalletClient (built from skRef) for the use-ask-stream
   * sign-request handler. Returns null when no session key is held.
   * Uses createWalletClient so the account/chain/transport are all correct.
   */
  const getSessionWalletClient = useCallback((): WalletClient | null => {
    if (!skRef.current) return null;
    const sessAccount = privateKeyToAccount(skRef.current);
    return createWalletClient({
      account: sessAccount,
      chain: arcTestnet,
      transport: http(kConfig.rpcUrl),
    });
  }, []);

  return {
    state,
    tryRecover,
    recoverViaSignature,
    generateAndFund,
    topUp,
    revoke,
    getSessionWalletClient,
    markExpired,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Minimal ABI for GatewayWallet.deposit(address token, uint256 value).
 * Copied from @circle-fin/x402-batching/dist/client/index.js:236-246 (GATEWAY_WALLET_ABI).
 * The function is NOT exported by the SDK, so we define it inline.
 * Selector: keccak256("deposit(address,uint256)") = 0x47e7ef24.
 */
const GATEWAY_WALLET_DEPOSIT_ABI = [
  {
    name: "deposit",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "token",  type: "address" as const },
      { name: "value",  type: "uint256" as const },
    ],
    outputs: [],
  },
] as const;

/** Approve + deposit USDC into Circle's Gateway from the session wallet. */
async function depositToGateway(
  sessionWallet: SessionWalletClient,
  publicClient: SessionPublicClient,
  budgetUsdc: number,
): Promise<string> {
  const amountAtomic = parseUnits(budgetUsdc.toFixed(6), 6);

  // 1. Approve the Gateway wallet to pull USDC from the session EOA.
  const approveTx = await sessionWallet.writeContract({
    address: kConfig.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [kConfig.gatewayWallet, amountAtomic],
    chain: arcTestnet,
    account: sessionWallet.account!,
  });
  const approveRcpt = await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 90_000 });
  if (approveRcpt.status !== "success") {
    throw new Error("USDC approval reverted — could not authorise the Gateway deposit.");
  }

  // 2. Call the Gateway deposit function.
  //    Verified against @circle-fin/x402-batching/dist/client/index.js:236-246:
  //    GATEWAY_WALLET_ABI shows deposit(address token, uint256 value) — two params.
  //    The old raw-calldata selector 0xb6b55f25 was keccak256("deposit(uint256)") — wrong.
  //    Correct selector: keccak256("deposit(address,uint256)") = 0x47e7ef24.
  const depositTx = await sessionWallet.writeContract({
    address: kConfig.gatewayWallet,
    abi: GATEWAY_WALLET_DEPOSIT_ABI,
    functionName: "deposit",
    args: [kConfig.usdcAddress, amountAtomic],
    gas: BigInt(120000),
    chain: arcTestnet,
    account: sessionWallet.account!,
  });
  const depositRcpt = await publicClient.waitForTransactionReceipt({ hash: depositTx, timeout: 90_000 });
  if (depositRcpt.status !== "success") {
    throw new Error("Gateway deposit reverted — funds stayed in the session address.");
  }
  return depositTx;
}
