"use client";

import { readGatewayCredit } from "../gateway/read-credit";
import { createSessionGrantClock } from "../session-grant-time";
import { watchSessionGrantClock } from "../session-grant-liveness";
import { readBoundedJson } from "../read-bounded-json";
import { sessionRevokeRequestSchema } from "../session-revoke-request";

/** Build-selected session lifecycle. The implementation below preserves historical testnet
 * derivation/funding behavior; mainnet uses useMainnetSessionGrant and retained original
 * same-browser custody. It funds via owner approve/depositFor and admits dual-proof consent.
 * No repeated personal_sign recovery guarantee applies across wallets or devices. Logout and
 * expiry lock mainnet payments without deleting funded recovery or exposed authorizations.
 * Same-origin script can use IndexedDB's wrapping CryptoKey to decrypt stored ciphertext and
 * observes initial derivation signatures. Worker isolation is not an XSS-proof vault or
 * on-chain spending cap. See docs/mainnet-browser-custody.md for custody and recovery limits.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import { createWalletClient, http, parseEther, type PublicClient, type WalletClient } from "viem";
import { arcTestnet } from "viem/chains";
import { config as kConfig } from "@/lib/config";
import { getSessionSigner, type SessionSigner } from "@/lib/session/session-signer-client";
import { depositToGateway } from "@/lib/session/gateway-deposit";
import {
  clearPending,
  clearSession,
  isPendingFresh,
  markPending,
  purgeLegacyPlaintextKey,
  readSession,
  writeSession,
} from "@/lib/session/session-storage";
import { browserPaymentProfile } from "../browser-payment-profile";
import { useMainnetSessionGrant } from "./use-mainnet-session-grant";

// Extra native USDC sent to the session EOA on top of the funded budget so it can pay gas for its
// own approve + Gateway-deposit txs (Arc gas is tiny). Leftover stays in the session EOA and is
// recoverable via the derived key.
const SESSION_GAS_BUFFER_USDC = 0.01;

// Fixed message signed to derive the session key. MUST stay byte-for-byte constant across releases
// — changing it would derive a different key and "lose" access to existing funded sessions.
// Versioned so a deliberate rotation is explicit.
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
  | "restoring"        // reading retained same-browser mainnet custody; no wallet prompt
  | "recovering"       // re-deriving key from a signature to resume a funded session
  | "active"
  | "paused"           // status unknown; retain funded session and require recovery
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
  grantEpoch: string | null;
  error: string | null;
  consentReview?: { cumulativeCapUsdc: number; confirmedSpentUsdc: number; retainedSpentUsdc: number;
    remainingCapacityUsdc: number; availableUsdc: number };
}

const INITIAL: GrantState = {
  status: "idle",
  sessAddr: null,
  sessionId: null,
  cap: 0,
  spent: 0,
  expiresAt: null,
  grantEpoch: null,
  error: null,
};

/** Ask the user's wallet for the derivation signature. The signature — not a key — is what we hold. */
async function deriveSignature(walletClient: WalletClient): Promise<string> {
  return walletClient.signMessage({
    account: walletClient.account!,
    message: DERIVE_MESSAGE,
  });
}

function useTestnetSessionGrant() {
  const [state, setState] = useState<GrantState>(INITIAL);
  const grantClock = useRef<ReturnType<typeof createSessionGrantClock> | null>(null);
  const registration = useRef(0);
  const signingPaused = useRef(false);
  // Handle on the worker that holds the key. Never the key itself.
  const signerRef = useRef<SessionSigner | null>(null);

  const { data: walletClient } = useWalletClient();
  const currentOwner = walletClient?.account?.address.toLowerCase() ?? null;
  const ownerRef = useRef(currentOwner);
  useLayoutEffect(() => { ownerRef.current = currentOwner; }, [currentOwner]);
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  // A tab that ran an older build still has a raw key sitting in sessionStorage. Drop it.
  useEffect(() => {
    purgeLegacyPlaintextKey();
  }, []);

  const signer = useCallback((): SessionSigner => {
    signerRef.current ??= getSessionSigner();
    return signerRef.current;
  }, []);

  /** A viem wallet client whose signing happens inside the worker. Null when no key is loaded. */
  const getSessionWalletClient = useCallback((): WalletClient | null => {
    if (signingPaused.current) return null;
    const account = signerRef.current?.account();
    if (!account) return null;
    const generation = registration.current;
    const assertCurrent = () => {
      if (signingPaused.current || registration.current !== generation ||
          signerRef.current?.sessionAddress !== account.address)
        throw new Error("Session signing paused or registration changed");
    };
    // A caller may retain this client across awaited payee/price checks. Fence
    // the actual dispatch as well as client lookup before a bearer signature.
    return createWalletClient({ account: { ...account,
      signTypedData: async args => { assertCurrent(); return account.signTypedData(args); },
      signTransaction: async (args, options) => { assertCurrent(); return account.signTransaction(args, options); },
    }, chain: arcTestnet, transport: http(kConfig.rpcUrl) });
  }, []);

  /**
   * Ensure the connected wallet is on Arc Testnet before any tx. If it isn't,
   * sendTransaction({chain: arcTestnet}) would silently wait for a network switch the user never
   * sees prompted — the "Waiting for USDC transfer…" hang.
   */
  const ensureArc = useCallback(async () => {
    if (walletClient && walletClient.chain?.id !== arcTestnet.id) {
      await switchChainAsync({ chainId: arcTestnet.id });
    }
  }, [walletClient, switchChainAsync]);

  /**
   * Shared resume core: read the live Gateway balance under the (deterministic) session address,
   * re-register the grant in recover mode with cap = that real balance, and mark the session
   * active. Returns false when the Gateway shows nothing yet (deposit still confirming, or empty).
   * The session is NEVER shown active against a zero balance, which would fail Circle's verify.
   * Re-registering also restores a grant the server lost, so a redeploy never strands a session.
   */
  const resumeSession = useCallback(async (sessAddr: string): Promise<boolean> => {
    const generation = ++registration.current;
    const owner = ownerRef.current;
    if (!owner) throw new Error("Session owner unavailable");
    const residualUsdc = Number(await readGatewayCredit(sessAddr)) / 1e6;
    if (generation !== registration.current || ownerRef.current !== owner) throw new Error("Session registration changed");
    if (residualUsdc <= 0) return false;

    const started = performance.now();
    const res = await fetch("/api/session/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessAddr, budget: residualUsdc, recover: true }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(error ?? "grant registration failed");
    }
    // The server re-reads the Gateway itself and clamps the cap to what is really there. Trust its
    // number over the one we read a moment ago — a spend could have landed since.
    const body = await readBoundedJson(res, 8192);
    const { sessionId, expiresAt, cap } = body as {
      sessionId: string;
      expiresAt: string;
      cap?: number;
    };
    if (generation !== registration.current || ownerRef.current !== owner) throw new Error("Session registration changed");
    const clock = createSessionGrantClock(body, { sessionId: owner, sessAddr }, started, performance.now(), kConfig.sessionGrantTtlSeconds * 1000);
    grantClock.current = clock;
    signingPaused.current = false;
    clearPending(); // credit confirmed → no longer waiting
    setState({
      status: "active",
      sessAddr,
      sessionId,
      cap: cap ?? residualUsdc,
      spent: 0,
      expiresAt,
      grantEpoch: clock.grantEpoch,
      error: null,
    });
    return true;
  }, []);

  /** Auto-restore on reload (called on mount by the dialog). Rehydrates the worker from ciphertext —
   *  no signature. Activates when the Gateway balance is real; if a deposit is still pending, enters
   *  "confirming" so the background poller below auto-activates it without any user action. */
  const tryRecover = useCallback(async (): Promise<boolean> => {
    const saved = readSession();
    if (!saved) return false;

    let sessAddr: string;
    try {
      sessAddr = await signer().restore(saved.blob);
    } catch {
      // Ciphertext we can no longer unwrap (wrapping key destroyed on revoke, or another tab
      // rotated it). Nothing recoverable here — a signature still reproduces the same key.
      clearSession();
      return false;
    }

    try {
      if (await resumeSession(sessAddr)) return true;
    } catch {
      // Re-register failed (transient) — fall through to the pending path.
    }
    if (isPendingFresh()) {
      setState((s) => ({ ...s, status: "confirming", sessAddr: saved.sessAddr }));
      return true;
    }
    return false;
  }, [resumeSession, signer]);

  // Background auto-resume: while a deposit is confirming, poll the Gateway every few seconds and
  // flip to "active" the moment the credit lands — no button, no timeout dead-end. Gives up only
  // after ~8 min with a calm note; the funds stay safe on-chain and a later visit auto-resumes.
  useEffect(() => {
    if (state.status !== "confirming") return;
    let cancelled = false;
    let tries = 0;
    const id = setInterval(async () => {
      if (cancelled) return;
      tries++;
      const sessAddr = signerRef.current?.sessionAddress;
      if (sessAddr) {
        try {
          if (await resumeSession(sessAddr)) return; // success → status flips → effect cleans up
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
  }, [state.status, resumeSession]);

  /**
   * Flip an active session to "expired" when its server-side grant TTL lapses. The session key and
   * the Gateway balance are untouched — recovery re-registers a fresh grant. Idempotent.
   */
  const markExpired = useCallback(() => {
    grantClock.current = null;
    setState((s) => (s.status === "active" ? { ...s, status: "expired" } : s));
  }, []);

  // Advisory UI timer. The server rejects expired supplied grants; it never switches
  // a supplied spending session to treasury funding.
  useEffect(() => {
    if (state.status !== "active") return;
    const current = grantClock.current;
    const unavailable = () => {
      grantClock.current = null;
      setState(s => s.status === "active" ? { ...s, status: "paused", error: "Session status unavailable. Recover the retained session to continue." } : s);
    };
    if (!current || current.ownerAddr !== walletClient?.account?.address.toLowerCase()) {
      const timer = setTimeout(unavailable, 0); return () => clearTimeout(timer);
    }
    return watchSessionGrantClock(current, () => grantClock.current === current && ownerRef.current === current.ownerAddr,
      markExpired, unavailable);
  }, [state.status, state.expiresAt, state.sessionId, state.sessAddr, state.grantEpoch, walletClient?.account?.address, markExpired]);

  /**
   * Full grant flow: derive key in the worker → fund EOA → deposit to Gateway → register grant.
   * budgetUsdc is the total USDC the user wants to fund into the session.
   */
  const generateAndFund = useCallback(
    async (budgetUsdc: number) => {
      if (!walletClient || !publicClient) {
        setState((s) => ({ ...s, status: "error", error: "Wallet not connected — connect MetaMask first" }));
        return;
      }
      const pc = publicClient as PublicClient;

      try {
        // 0. Make sure the wallet is on Arc before any tx — otherwise the funding sendTransaction
        //    silently waits on a network switch and looks hung.
        setState({ ...INITIAL, status: "switching" });
        await ensureArc();

        setState((s) => ({ ...s, status: "generating" }));
        // 1. One signature, handed to the worker. The key is derived there and stays there.
        const signature = await deriveSignature(walletClient);
        const { address: sessAddr, wrapped, iv } = await signer().deriveFromSignature(signature);

        // Persist the ciphertext BEFORE funding so a reload mid-flow can recover via the Gateway
        // balance instead of losing the in-progress session. sessionId here is the connected
        // address (what the server uses); the grant response overwrites it at the end.
        writeSession({ wrapped, iv }, sessAddr, walletClient.account!.address.toLowerCase());

        // 2. Move USDC into the session EOA — but only what it is actually short of. The session
        //    address is deterministic, so an earlier attempt that funded it and then failed before
        //    the deposit left the money sitting right here. Charging the user for it twice would be
        //    the wrong answer; when the address already holds enough, no MetaMask prompt at all.
        //    On Arc, USDC IS the native gas token — an ERC-20 transfer() between EOAs on the 0x3600
        //    interface reverts (and MetaMask's failed gas-estimate can hang), so this is a NATIVE
        //    value transfer (18-decimal). The buffer lets the EOA pay gas for its own
        //    approve + deposit; the leftover stays recoverable under the derived key.
        const needed = parseEther((budgetUsdc + SESSION_GAS_BUFFER_USDC).toFixed(18));
        const held = await publicClient.getBalance({ address: sessAddr });

        if (held < needed) {
          setState((s) => ({ ...s, status: "funding", sessAddr }));
          // NOTE: do NOT pass `chain` here. ensureArc() already guaranteed the wallet is on Arc;
          // passing `chain` makes viem assert chainId against the (possibly stale) injected client
          // before sending, which can hang BEFORE MetaMask ever shows the prompt.
          const usdcTx = await walletClient.sendTransaction({
            account: walletClient.account!,
            to: sessAddr,
            value: needed - held,
            gas: BigInt(21000),
          });
          const fundReceipt = await publicClient.waitForTransactionReceipt({
            hash: usdcTx,
            timeout: 90_000,
          });
          if (fundReceipt.status !== "success") {
            throw new Error("Funding transfer reverted on-chain — please try again.");
          }
        }

        setState((s) => ({ ...s, status: "depositing", sessAddr }));

        // 3. Browser-side Gateway deposit, signed by the worker.
        const sessionWalletClient = getSessionWalletClient();
        if (!sessionWalletClient) throw new Error("session signer is not ready");
        await depositToGateway(sessionWalletClient, pc, budgetUsdc);

        // 4. Hand off to background confirmation. Circle's off-chain credit lags ~10-90s; rather
        //    than block the user (and dead-end on a timeout), mark the deposit pending and enter
        //    "confirming". The poller flips to "active" the moment the credit lands. We must NOT
        //    activate before the credit is real, or the first ask would fail Circle's verify.
        markPending();
        setState((s) => ({ ...s, status: "confirming", sessAddr }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, status: "error", error: /reject|denied/i.test(message) ? "Network switch or signature was rejected." : message }));
      }
    },
    [walletClient, publicClient, ensureArc, signer, getSessionWalletClient],
  );

  /**
   * Recover a funded session on a fresh tab / different browser / after sign-out. Re-derives the key
   * in the worker from a wallet signature (same wallet → same key), looks up how much USDC remains
   * in the Gateway under that session EOA, and re-registers the server grant.
   *
   * If the Gateway holds nothing under the derived address, there is nothing to recover (or the
   * wallet signs non-deterministically) — we say so, never silently creating an empty session.
   */
  const recoverViaSignature = useCallback(async () => {
    const retained = state.status === "paused" && state.sessionId ? state : null;
    const failRecovery = (message: string) => setState(s => retained
      ? s.sessionId === retained.sessionId && s.grantEpoch === retained.grantEpoch && s.status === "paused"
        ? { ...s, error: message } : s
      : { ...s, status: "error", error: message });
    if (!walletClient) {
      failRecovery("Connect your wallet first");
      return;
    }
    const generation = ++registration.current, owner = ownerRef.current;
    if (!retained) setState({ ...INITIAL, status: "recovering" });
    try {
      const signature = await deriveSignature(walletClient);
      if (generation !== registration.current || ownerRef.current !== owner) return;
      const { address: sessAddr, wrapped, iv } = await signer().deriveFromSignature(signature);
      if (generation !== registration.current || ownerRef.current !== owner) return;
      const ok = await resumeSession(sessAddr);
      if (!ok) {
        if (retained) { failRecovery("No recoverable balance confirmed. Your retained session remains paused."); return; }
        await signer().clear();
        setState({
          ...INITIAL,
          status: "error",
          error: "No recoverable session found for this wallet (the deposit may still be confirming — try again shortly).",
        });
        return;
      }
      writeSession({ wrapped, iv }, sessAddr, walletClient.account!.address.toLowerCase());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failRecovery(/reject|denied/i.test(message) ? "Signature rejected" : message);
    }
  }, [walletClient, resumeSession, signer, state]);

  /**
   * Extend the current session without any wallet interaction. The signer worker still holds the
   * key, so re-registering the grant in recover mode issues a fresh TTL and re-reads the cap from
   * the live Gateway balance — no signature, no gas, no new funds. Works from "active" (before the
   * TTL lapses) and from "expired" in the same tab (the worker outlives the grant). Returns false
   * when the Gateway holds nothing under the session address — nothing left to authorise.
   */
  const extend = useCallback(async (): Promise<boolean> => {
    const sessAddr = signerRef.current?.sessionAddress ?? state.sessAddr;
    if (!sessAddr) return false;
    try {
      return await resumeSession(sessAddr);
    } catch {
      return false; // transient — the caller offers signature recovery as the fallback
    }
  }, [state.sessAddr, resumeSession]);

  /**
   * Add more USDC to the ACTIVE session: fund the existing session EOA, deposit it into the
   * Gateway, then re-register the grant with the new (confirmed) total. No new key.
   */
  const topUp = useCallback(
    async (addUsdc: number) => {
      const sessionWalletClient = getSessionWalletClient();
      if (!sessionWalletClient || !state.sessAddr || state.status !== "active") return;
      if (!walletClient || !publicClient) {
        setState((s) => ({ ...s, status: "error", error: "Wallet not connected" }));
        return;
      }
      const pc = publicClient as PublicClient;
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
        await depositToGateway(sessionWalletClient, pc, addUsdc);

        // Hand off to the background poller (same as the initial fund): it re-reads the new total
        // once Circle credits it and updates the active cap. cap stays at the old value until then.
        markPending();
        setState((s) => ({ ...s, status: "confirming" }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, status: "error", error: message }));
      }
    },
    [walletClient, publicClient, state.sessAddr, state.status, ensureArc, getSessionWalletClient],
  );

  /**
   * Revoke the server-side grant. Returns the residual USDC so the caller can offer to withdraw it
   * from the Gateway back to the user's wallet. The on-chain withdraw is signed by the user's own
   * wallet (GrantSpendDialog), not the session key — which is why burning the key here is safe.
   */
  const revoke = useCallback(async (): Promise<{ residualUsdc: number; sessAddr: string | null }> => {
    const expected = { sessionId: state.sessionId, grantEpoch: state.grantEpoch, sessAddr: state.sessAddr };
    const generation = ++registration.current; grantClock.current = null; signingPaused.current = true;
    setState((s) => ({ ...s, status: "revoking" }));
    try {
      const parsed = sessionRevokeRequestSchema.safeParse(expected);
      if (!parsed.success) throw new Error("Session identity unavailable. Recover the retained session before revoking again.");
      const res = await fetch("/api/session/revoke", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const data = await readBoundedJson(res, 8192) as { ok?: boolean; alreadyRevoked?: boolean; sessAddr?: string; residualUsdc?: number };
      if (!res.ok || data?.ok !== true || (data.alreadyRevoked !== true &&
          (data.sessAddr?.toLowerCase() !== state.sessAddr?.toLowerCase() ||
           typeof data.residualUsdc !== "number" || !Number.isFinite(data.residualUsdc) || data.residualUsdc < 0)))
        throw new Error(res.status === 409 ? "Your spending session changed. Recover the retained session before revoking again."
          : "Revocation could not be confirmed. Recover the retained session before spending again.");
      if (generation !== registration.current) return { residualUsdc: 0, sessAddr: state.sessAddr };
      const residualUsdc = data.residualUsdc ?? 0;
      const sessAddr = state.sessAddr;

      // Drop the key from the worker and destroy the wrapping key, so the ciphertext this tab (or
      // any other) still holds becomes permanently unreadable.
      await signer().clear();
      if (generation !== registration.current) return { residualUsdc: 0, sessAddr: state.sessAddr };
      clearSession();

      setState({ ...INITIAL, status: "revoked" });
      return { residualUsdc, sessAddr };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (generation === registration.current) setState((s) => ({ ...s, status: "paused", error: message }));
      return { residualUsdc: 0, sessAddr: state.sessAddr };
    }
  }, [state.sessionId, state.grantEpoch, state.sessAddr, signer]);

  return {
    state,
    tryRecover,
    recoverViaSignature,
    generateAndFund,
    topUp,
    extend,
    revoke,
    getSessionWalletClient,
    markExpired,
    authorizeSessionPayment: undefined,
  };
}

// Immutable build selection; hook identity cannot change between renders or from requests.
const useConfiguredSessionGrant = browserPaymentProfile().testnet ? useTestnetSessionGrant : useMainnetSessionGrant;
export function useSessionGrant() { return useConfiguredSessionGrant(); }
