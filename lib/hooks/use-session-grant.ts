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
import { createWalletClient, http, parseUnits, erc20Abi, keccak256, type WalletClient } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config as kConfig } from "@/lib/config";

const SESSION_KEY_STORAGE = "keryx_session_sk";
const SESSION_ADDR_STORAGE = "keryx_session_addr";
const SESSION_ID_STORAGE = "keryx_session_id";

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
  | "depositing"       // calling gateway.deposit() from browser
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

  /** Try to restore a session key from sessionStorage (called on mount by the dialog). */
  const tryRecover = useCallback(() => {
    const saved = recoverFromStorage();
    if (!saved) return false;
    skRef.current = saved.sk;
    setState((s) => ({
      ...s,
      status: "active",
      sessAddr: saved.sessAddr,
      sessionId: saved.sessionId,
    }));
    return true;
  }, []);

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

        setState((s) => ({ ...s, status: "funding", sessAddr }));

        // 2. One MetaMask tx: transfer USDC to the session EOA.
        //    The user signs this with their own wallet (MetaMask shows the amount clearly).
        const amountAtomic = parseUnits(budgetUsdc.toFixed(6), 6);
        const usdcTx = await walletClient.writeContract({
          address: kConfig.usdcAddress,
          abi: erc20Abi,
          functionName: "transfer",
          args: [sessAddr, amountAtomic],
        });
        await publicClient.waitForTransactionReceipt({ hash: usdcTx });

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

        // 4. Poll until the Gateway credit is visible (off-chain, lags ~10-90s).
        await pollGatewayCredit(sessAddr, budgetUsdc);

        setState((s) => ({ ...s, status: "registering" }));

        // 5. Register the grant server-side. The server records sessAddr + cap
        //    but NEVER receives the private key.
        const res = await fetch("/api/session/grant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessAddr, budget: budgetUsdc, txHash: depositTxHash }),
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
          cap: budgetUsdc,
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
      const sessAddr = privateKeyToAccount(sk).address;

      // How much USDC is still in the Gateway under this derived session EOA?
      const creditRes = await fetch(
        `/api/session/credit?address=${encodeURIComponent(sessAddr)}`,
      );
      const credit = (await creditRes.json().catch(() => ({}))) as { available?: string };
      const residualUsdc = Number(BigInt(credit.available ?? "0")) / 1e6;

      if (residualUsdc <= 0) {
        skRef.current = null;
        setState({
          ...INITIAL,
          status: "error",
          error: "No recoverable session found for this wallet.",
        });
        return;
      }

      skRef.current = sk;

      // Re-register the grant (recover mode: funds are in the Gateway, not the EOA,
      // so the server skips the EOA-balance check). cap = the residual still on deposit.
      const res = await fetch("/api/session/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessAddr, budget: residualUsdc, recover: true }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? "recovery failed");
      }
      const { sessionId, expiresAt } = (await res.json()) as {
        sessionId: string;
        expiresAt: string;
      };
      saveToStorage(sk, sessAddr, sessionId);
      setState({
        status: "active",
        sessAddr,
        sessionId,
        cap: residualUsdc,
        spent: 0,
        expiresAt,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({
        ...s,
        status: "error",
        error: /reject|denied/i.test(message) ? "Signature rejected" : message,
      }));
    }
  }, [walletClient]);

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
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

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
  await publicClient.waitForTransactionReceipt({ hash: depositTx });
  return depositTx;
}

/**
 * Poll the Gateway credit balance via the server-side proxy (/api/session/credit).
 *
 * Direct browser calls to Circle's balance API (gateway-api-testnet.circle.com)
 * fail with CORS errors. The proxy makes the request server-side — same pattern
 * as RealGateway.ensureFunded()'s polling loop — and returns { available: string }.
 *
 * Times out after 90 seconds; caller continues even if credit hasn't confirmed yet.
 */
async function pollGatewayCredit(sessAddr: string, expectedUsdc: number): Promise<void> {
  const deadline = Date.now() + 90_000;
  const minAtomic = parseUnits(expectedUsdc.toFixed(6), 6);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/session/credit?address=${encodeURIComponent(sessAddr)}`,
      );
      if (res.ok) {
        const data = await res.json() as { available?: string };
        const available = BigInt(data.available ?? "0");
        if (available >= minAtomic - parseUnits("0.01", 6)) return;
      }
    } catch { /* ignore transient errors */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  // Timeout — continue; Gateway may still credit before the first payment attempt.
}
