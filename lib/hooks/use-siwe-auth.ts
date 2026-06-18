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

import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { arcTestnet } from "@/lib/chains";

export type AuthState = "idle" | "signing" | "verifying";
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

  /** Re-read the current session cookie. Returns the session (or null). */
  const refresh = useCallback(async (): Promise<AuthSession | null> => {
    try {
      const res = await fetch("/api/auth/session");
      const s = res.ok ? ((await res.json()).session ?? null) : null;
      setSession(s);
      return s;
    } catch {
      setSession(null);
      return null;
    }
  }, []);

  // Restore any existing session on mount. Inlined (not via refresh()) so the
  // setState lands only in the async continuation, after the fetch resolves.
  useEffect(() => {
    let active = true;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { session?: AuthSession | null } | null) => {
        if (active) setSession(data?.session ?? null);
      })
      .catch(() => {
        if (active) setSession(null);
      });
    return () => {
      active = false;
    };
  }, []);

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
      return { ok: true, created: verifyData.created, role };
    } finally {
      setAuthState("idle");
    }
  }, [address, signMessageAsync, refresh]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    setSession(null);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("keryx:auth"));
  }, []);

  return { address, isConnected, session, authState, signIn, signOut, refresh };
}
