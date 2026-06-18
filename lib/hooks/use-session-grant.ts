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

import { useCallback, useRef, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { createWalletClient, http, parseUnits, parseEther, erc20Abi, keccak256, type WalletClient } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config as kConfig } from "@/lib/config";

const SESSION_KEY_STORAGE = "keryx_session_sk";
const SESSION_ADDR_STORAGE = "keryx_session_addr";
const SESSION_ID_STORAGE = "keryx_session_id";

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
  | "generating"
  | "funding"          // waiting for MetaMask fund tx
  | "depositing"       // session EOA approve + Gateway deposit txs
  | "confirming"       // waiting for Circle Gateway to reflect the credit (off-chain lag)
  | "registering"      // POSTing to /api/session/grant
  | "recovering"       // re-deriving key from a signature to resume a funded session
  | "active"
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
  } catch { /* ignore */ }
}

export function useSessionGrant() {
  const [state, setState] = useState<GrantState>(INITIAL);
  // The session private key lives ONLY in this ref (and sessionStorage for reload recovery).
  const skRef = useRef<`0x${string}` | null>(null);

  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

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
    setState({ status: "active", sessAddr, sessionId, cap: residualUsdc, spent: 0, expiresAt, error: null });
    return true;
  }, []);

  /** Auto-restore on reload (called on mount by the dialog). Uses the key cached in
   *  sessionStorage — no signature — and only activates when the Gateway balance is real. */
  const tryRecover = useCallback(async () => {
    const saved = recoverFromStorage();
    if (!saved) return false;
    try {
      return await resumeFromKey(saved.sk);
    } catch {
      // Re-register failed (transient) — keep the cached key so a later attempt works.
      return false;
    }
  }, [resumeFromKey]);

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

      setState({ ...INITIAL, status: "generating" });

      try {
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
        const usdcTx = await walletClient.sendTransaction({
          account: walletClient.account!,
          chain: arcTestnet,
          to: sessAddr,
          value: parseEther((budgetUsdc + SESSION_GAS_BUFFER_USDC).toFixed(18)),
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
        const depositTxHash = await depositToGateway(sessionWalletClient, pc, budgetUsdc);

        // 4. Wait for the Gateway to actually credit the deposit. This is Circle's
        //    off-chain confirmation (lags ~10-90s) — its own "confirming" phase.
        //    CRITICAL: we must NOT activate until the credit is real, or the first ask
        //    would sign against a balance that isn't there yet and fail Circle's verify.
        setState((s) => ({ ...s, status: "confirming" }));
        const confirmedUsdc = await pollGatewayCredit(sessAddr, budgetUsdc);
        if (confirmedUsdc === null) {
          // Funds are safe on-chain in the Gateway under sessAddr (deterministic key);
          // the credit just hasn't reflected. Tell the user to resume shortly.
          throw new Error(
            "Deposit is taking longer than usual to confirm on the Gateway. Your funds are safe — click \"Recover funded session\" in a minute to resume.",
          );
        }

        setState((s) => ({ ...s, status: "registering" }));

        // 5. Register the grant server-side. cap = the CONFIRMED credited amount so the
        //    server never authorises more than the Gateway can actually settle.
        const res = await fetch("/api/session/grant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessAddr, budget: confirmedUsdc, txHash: depositTxHash }),
        });

        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: "grant registration failed" })) as { error?: string };
          throw new Error(error ?? "grant registration failed");
        }

        const grantData = await res.json() as { sessionId: string; expiresAt: string };
        const { sessionId, expiresAt } = grantData;

        // 6. Save to sessionStorage so a page refresh can recover the key.
        saveToStorage(sk, sessAddr, sessionId);

        setState({
          status: "active",
          sessAddr,
          sessionId,
          cap: confirmedUsdc,
          spent: 0,
          expiresAt,
          error: null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, status: "error", error: message }));
      }
    },
    [walletClient, publicClient],
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
      const prevRemaining = Math.max(0, state.cap - state.spent);
      try {
        setState((s) => ({ ...s, status: "funding" }));
        const tx = await walletClient.sendTransaction({
          account: walletClient.account!,
          chain: arcTestnet,
          to: sessAddr,
          value: parseEther((addUsdc + SESSION_GAS_BUFFER_USDC).toFixed(18)),
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

        setState((s) => ({ ...s, status: "confirming" }));
        const confirmed = await pollGatewayCredit(sessAddr, prevRemaining + addUsdc);
        if (confirmed === null) {
          throw new Error("Top-up is still confirming on the Gateway — your funds are safe; reload to see the updated balance.");
        }
        setState((s) => ({ ...s, status: "registering" }));
        await resumeFromKey(sk); // re-reads the new balance → updates cap + re-registers
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, status: "error", error: message }));
      }
    },
    [walletClient, publicClient, state.sessAddr, state.cap, state.spent, state.status, resumeFromKey],
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

/**
 * Poll the Gateway credit balance via the server-side proxy (/api/session/credit).
 *
 * Direct browser calls to Circle's balance API (gateway-api-testnet.circle.com)
 * fail with CORS errors. The proxy makes the request server-side — same pattern
 * as RealGateway.ensureFunded()'s polling loop — and returns { available: string }.
 *
 * Returns the confirmed available USDC (number) once it reaches ~expected, or null
 * if the credit never reflected within the timeout (120s). The caller must NOT
 * activate a session on null — spending against an uncredited deposit fails Circle's
 * verify. The funds are safe on-chain and recoverable once the credit lands.
 */
async function pollGatewayCredit(sessAddr: string, expectedUsdc: number): Promise<number | null> {
  const deadline = Date.now() + 120_000;
  const minAtomic = parseUnits(expectedUsdc.toFixed(6), 6) - parseUnits("0.01", 6);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/session/credit?address=${encodeURIComponent(sessAddr)}`,
      );
      if (res.ok) {
        const data = await res.json() as { available?: string };
        const availableAtomic = BigInt(data.available ?? "0");
        if (availableAtomic >= minAtomic) {
          return Number(availableAtomic) / 1e6;
        }
      }
    } catch { /* ignore transient errors */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null; // credit never confirmed within the window
}
