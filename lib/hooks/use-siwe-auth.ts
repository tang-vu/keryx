"use client";
import { parseDatedAuthChallenge } from "../auth-time-policy";
import { isOwnBrowserAuthChange, notifyBrowserAuthChanged } from "../browser-auth-notice";

/**
 * useSiweAuth — the canonical wallet sign-in / sign-out flow, shared by the
 * header wallet menu and the /connect page so the SIWE logic lives in one place.
 *
 * Flow (signIn): GET /api/auth/nonce → build + sign a SIWE message in the wallet
 * → POST /api/auth/verify (mints the keryx_session JWT and upserts the account)
 * → GET /api/auth/session for the FRESH role. On first verify the server creates
 * the user account; `created` is surfaced so callers can tell "account created"
 * from "welcome back".
 *
 * `session` is undefined while the initial session check is in flight, null when
 * signed out, and the session object when signed in.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { arcChain } from "@/lib/chains";
import { CIRCLE_GOOGLE_CONNECTOR_ID } from "../circle-wallet-config";
import { circleWalletIdentity, clearCircleWalletIdentity } from "../circle-wallet-browser";

export type AuthState = "idle" | "signing" | "verifying" | "signing-out";
export interface AuthSession {
  address: string;
  role: string;
}

export interface SignInResult {
  ok: boolean;
  created?: boolean;
  role?: string;
}

// Local attempt counters/publishing own the privacy boundary before IO. Peer
// source/sequence values only order invalidation hints; they never own an attempt.
type LogoutNotice = { type: "logout"; source: string; sequence: number; pending: boolean; confirmed: boolean };
const logoutSources = new Map<string, LogoutNotice>();
// Receiver-owned lease: a vanished document cannot leave peers pending forever.
// Expiry permits a NEW server check; it never confirms logout or restores auth.
// A null lease is exhausted until a terminal hint; higher sequences cannot renew it.
const peerLogoutLeases = new Map<string, ReturnType<typeof setTimeout> | null>();
const peerLogoutLeaseMs = 20000; // Existing 15s fetch deadline plus delivery slack.
let logoutEpoch = 0, logoutSequence = 0, localLogouts = 0;
let logoutSource: string | undefined;
const logoutPending = () => localLogouts > 0 || [...logoutSources.values()].some(value => value.pending);
function receiveLogout(value: unknown): LogoutNotice | null {
  if (!value || typeof value !== "object") return null;
  const incoming = value as LogoutNotice;
  if (incoming.type !== "logout" || typeof incoming.source !== "string" || !incoming.source || incoming.source.length > 128
    || !Number.isSafeInteger(incoming.sequence) || incoming.sequence < 1
    || typeof incoming.pending !== "boolean" || typeof incoming.confirmed !== "boolean") return null;
  // The advertised UUID is not sender authority. Never let a peer overwrite or
  // sequence-poison this document's publisher, even after its attempt completes.
  if (incoming.source === logoutSource || (logoutSources.get(incoming.source)?.sequence ?? 0) >= incoming.sequence) return null;
  const notice: LogoutNotice = { type: "logout", source: incoming.source, sequence: incoming.sequence,
    pending: incoming.pending && peerLogoutLeases.get(incoming.source) !== null, confirmed: false };
  logoutSources.set(notice.source, notice);
  // Keep ordering for this exhausted interval without fencing fresh server recovery.
  // Only an accepted terminal hint can end it and permit a new pending boundary.
  if (incoming.pending && peerLogoutLeases.get(notice.source) === null) return null;
  logoutEpoch++;
  if (!incoming.pending) {
    clearTimeout(peerLogoutLeases.get(notice.source) ?? undefined);
    peerLogoutLeases.delete(notice.source);
  } else if (!peerLogoutLeases.has(notice.source)) {
    peerLogoutLeases.set(notice.source, setTimeout(() => {
      peerLogoutLeases.set(notice.source, null);
      const latest = logoutSources.get(notice.source)!;
      // Retain the sequence tombstone, so a duplicate/old start cannot reopen it.
      const expired = { ...latest, pending: false, confirmed: false };
      logoutSources.set(notice.source, expired); logoutEpoch++;
      dispatchLogout(expired);
    }, peerLogoutLeaseMs));
  }
  return notice;
}
function dispatchLogout(notice: LogoutNotice) {
  window.dispatchEvent(new CustomEvent("keryx:auth", { detail: notice }));
  // Only the local HTTP/JSON-confirmed publisher can confirm logout/custody.
  // Peer snapshots are normalized to unconfirmed before reaching this dispatch.
  if (notice.confirmed) window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" }));
}
function publishLogout(channel: BroadcastChannel | null, confirmed = false) {
  logoutSource ??= crypto.randomUUID();
  const notice: LogoutNotice = { type: "logout", source: logoutSource, sequence: ++logoutSequence, pending: localLogouts > 0, confirmed };
  logoutEpoch++;
  dispatchLogout(notice);
  try { channel?.postMessage(notice); } catch { /* Local invalidation already happened. */ }
}

export function useSiweAuth() {
  const { address, isConnected, connector } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const revision = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const mounted = useRef(false);
  const observedLogout = useRef(logoutEpoch);
  const clearForLogout = useCallback(() => {
    if (observedLogout.current === logoutEpoch) return;
    observedLogout.current = logoutEpoch;
    revision.current++; setSession(null);
    setAuthState(logoutPending() ? "signing-out" : "idle");
  }, []);

  /** Re-read the current session cookie. Returns the session (or null). */
  const refresh = useCallback(async (): Promise<AuthSession | null> => {
    const attempt = ++revision.current;
    const boundary = logoutEpoch;
    if (logoutPending()) return null;
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok && res.status !== 401) throw new Error("Session lookup unavailable");
      const s = res.ok ? ((await res.json()).session ?? null) : null;
      if (!mounted.current || attempt !== revision.current || boundary !== logoutEpoch || logoutPending()) return null;
      const google = circleWalletIdentity();
      if (google && (!s || s.address?.toLowerCase() !== google.address.toLowerCase())) clearCircleWalletIdentity();
      setSession(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  // Restore any existing session on mount. Inlined (not via refresh()) so the
  // setState lands only in the async continuation, after the fetch resolves.
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const attempt = ++revision.current;
    const boundary = logoutEpoch;
    if (logoutPending()) { setSession(null); setAuthState("signing-out"); }
    else fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { session?: AuthSession | null } | null) => {
        if (active && attempt === revision.current && boundary === logoutEpoch && !logoutPending()) setSession(data?.session ?? null);
      })
      .catch(() => {
        if (active && attempt === revision.current && boundary === logoutEpoch) setSession(null);
      });
    return () => {
      active = false;
      mounted.current = false; revision.current++;
    };
  }, []);

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.type === "logout") { clearForLogout(); if (detail.confirmed) clearCircleWalletIdentity(); }
      else if (detail === "signed-out") { clearCircleWalletIdentity(); revision.current++; setSession(null); }
      else void refresh();
    };
    const focused = () => { void refresh(); };
    window.addEventListener("keryx:auth", changed);
    window.addEventListener("focus", focused);
    try {
      channel.current = new BroadcastChannel("keryx-auth-v1");
      channel.current.onmessage = event => {
        if (event.data?.type === "logout") {
          const notice = receiveLogout(event.data);
          if (notice) dispatchLogout(notice);
        }
        else if (event.data === "signed-out") { clearCircleWalletIdentity(); revision.current++; setSession(null); }
        // Anonymous channel hints can only clear state. Focus/manual refresh
        // obtains fresh server authority; a notice never starts private IO.
        else if (event.data === "changed" || event.data?.type === "changed") {
          if (!isOwnBrowserAuthChange(event.data)) { revision.current++; setSession(null); }
        }
      };
    } catch { /* Focus refresh remains available when browser messaging is disabled. */ }
    return () => {
      window.removeEventListener("keryx:auth", changed); window.removeEventListener("focus", focused);
      channel.current?.close(); channel.current = null;
    };
  }, [refresh, clearForLogout]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    if (!address || logoutPending()) return { ok: false };
    const boundary = logoutEpoch;
    const current = () => mounted.current && boundary === logoutEpoch && !logoutPending();
    if (connector?.id === CIRCLE_GOOGLE_CONNECTOR_ID) {
      // Google callback already proved Circle token -> wallet ownership on the server.
      // Never turn a persisted connector hint into authentication or prompt redundant SIWE.
      const fresh = await refresh();
      if (!fresh || fresh.address.toLowerCase() !== address.toLowerCase()) throw new Error("Reconnect with Google to sign in again");
      return { ok: true, role: fresh.role };
    }
    setAuthState("signing");
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { nonce, issuedAt, sessionExpiresAt } = parseDatedAuthChallenge(await nonceRes.json());
      if (!current()) return { ok: false };

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        // ASCII only — EIP-4361's ABNF rejects non-ASCII (e.g. an em-dash).
        statement: "Sign in to Keryx. Citations are currency.",
        uri: window.location.origin,
        version: "1",
        chainId: arcChain.id,
        nonce,
        issuedAt,
        expirationTime: sessionExpiresAt,
      });
      const prepared = message.prepareMessage();

      setAuthState("verifying");
      const signature = await signMessageAsync({ message: prepared });
      if (!current()) return { ok: false };

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prepared, signature }),
      });
      const verifyData = (await verifyRes.json()) as {
        ok?: boolean;
        address?: string;
        role?: string;
        created?: boolean;
        error?: string;
      };
      if (!verifyRes.ok) throw new Error(verifyData.error ?? "Verification failed");
      if (!current()) return { ok: false };

      // Pull the fresh role from the session endpoint (reflects live env/DB state).
      const fresh = await refresh();
      if (!current()) return { ok: false };
      const role = fresh?.role ?? verifyData.role;
      if (!fresh && verifyData.address && verifyData.role) {
        setSession({ address: verifyData.address, role: verifyData.role });
      }
      // Notify other hook instances (e.g. the session/faucet panel mounted
      // separately) that auth state changed, so they re-check without a reload.
      if (typeof window !== "undefined") notifyBrowserAuthChanged();
      return { ok: true, created: verifyData.created, role };
    } finally {
      if (mounted.current) setAuthState(logoutPending() ? "signing-out" : "idle");
    }
  }, [address, connector?.id, signMessageAsync, refresh]);

  const signOut = useCallback(async () => {
    // The attempt owns delivery through its ACK, independently of hook cleanup.
    let attemptChannel: BroadcastChannel | null = null;
    try { attemptChannel = new BroadcastChannel("keryx-auth-v1"); } catch { /* Local invalidation still applies. */ }
    localLogouts++;
    publishLogout(attemptChannel);
    let confirmed = false;
    try {
      const response = await fetch("/api/auth/signout", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok || (await response.json()).ok !== true) throw new Error("Sign-out could not be confirmed. Please retry.");
      confirmed = true;
      clearCircleWalletIdentity();
    } catch { throw new Error("Sign-out could not be confirmed. Please retry."); }
    finally {
      localLogouts--; publishLogout(attemptChannel, confirmed);
      attemptChannel?.close();
    }
  }, []);

  return { address, isConnected, session, authState, signIn, signOut, refresh };
}
