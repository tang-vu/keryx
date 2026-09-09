"use client";

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
import { arcTestnet } from "@/lib/chains";

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

export function useSiweAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const revision = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  /** Re-read the current session cookie. Returns the session (or null). */
  const refresh = useCallback(async (): Promise<AuthSession | null> => {
    const attempt = ++revision.current;
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok && res.status !== 401) throw new Error("Session lookup unavailable");
      const s = res.ok ? ((await res.json()).session ?? null) : null;
      if (attempt !== revision.current) return null;
      setSession(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  // Restore any existing session on mount. Inlined (not via refresh()) so the
  // setState lands only in the async continuation, after the fetch resolves.
  useEffect(() => {
    let active = true;
    const attempt = ++revision.current;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { session?: AuthSession | null } | null) => {
        if (active && attempt === revision.current) setSession(data?.session ?? null);
      })
      .catch(() => {
        if (active && attempt === revision.current) setSession(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail === "signed-out") { revision.current++; setSession(null); }
      else void refresh();
    };
    const focused = () => { void refresh(); };
    window.addEventListener("keryx:auth", changed);
    window.addEventListener("focus", focused);
    try {
      channel.current = new BroadcastChannel("keryx-auth-v1");
      channel.current.onmessage = focused;
    } catch { /* Focus refresh remains available when browser messaging is disabled. */ }
    return () => {
      window.removeEventListener("keryx:auth", changed); window.removeEventListener("focus", focused);
      channel.current?.close(); channel.current = null;
    };
  }, [refresh]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    if (!address) return { ok: false };
    setAuthState("signing");
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        // ASCII only — EIP-4361's ABNF rejects non-ASCII (e.g. an em-dash).
        statement: "Sign in to Keryx. Citations are currency.",
        uri: window.location.origin,
        version: "1",
        chainId: arcTestnet.id,
        nonce,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 7 * 86400e3).toISOString(),
      });
      const prepared = message.prepareMessage();

      setAuthState("verifying");
      const signature = await signMessageAsync({ message: prepared });

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

      // Pull the fresh role from the session endpoint (reflects live env/DB state).
      const fresh = await refresh();
      const role = fresh?.role ?? verifyData.role;
      if (!fresh && verifyData.address && verifyData.role) {
        setSession({ address: verifyData.address, role: verifyData.role });
      }
      // Notify other hook instances (e.g. the session/faucet panel mounted
      // separately) that auth state changed, so they re-check without a reload.
      if (typeof window !== "undefined") window.dispatchEvent(new Event("keryx:auth"));
      channel.current?.postMessage("changed");
      return { ok: true, created: verifyData.created, role };
    } finally {
      setAuthState("idle");
    }
  }, [address, signMessageAsync, refresh]);

  const signOut = useCallback(async () => {
    setAuthState("signing-out");
    try {
      const response = await fetch("/api/auth/signout", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok || (await response.json()).ok !== true) throw new Error("Sign-out could not be confirmed. Please retry.");
      revision.current++; setSession(null);
      window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" }));
      channel.current?.postMessage("changed");
    } finally { setAuthState("idle"); }
  }, []);

  return { address, isConnected, session, authState, signIn, signOut, refresh };
}
