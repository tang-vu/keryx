"use client";

/**
 * SessionGrantPanel — detects SIWE auth and shows GrantSpendDialog.
 *
 * Checks /api/auth/session on mount; when authed, renders the grant dialog.
 * Exposes sessionId + getSessionWalletClient upward so the ask stream can
 * auto-sign sign-requests without a MetaMask prompt.
 *
 * Unauthenticated users see nothing (offline / server-key ask still works).
 */

import { useEffect, useState, useRef } from "react";
import type { WalletClient } from "viem";
import { useSessionGrant } from "@/lib/hooks/use-session-grant";
import { GrantSpendDialog } from "@/components/keryx/grant-spend-dialog";
import { FaucetPanel } from "@/components/keryx/faucet-panel";

export interface SessionGrantBinding {
  /** sessionId to include in ask POST body; null when no active grant. */
  sessionId: string | null;
  /** Returns the session WalletClient for auto-signing, or null. */
  getSessionWalletClient: () => WalletClient | null;
  /**
   * H1: The funded grant cap in USDC, or undefined when no grant is active.
   * Passed into useAskStream so the browser enforces its own spend ceiling
   * independently of any server-side guard.
   */
  grantCap?: number;
}

interface Props {
  /** Called whenever the grant binding changes (auth state or grant activation). */
  onBindingChange: (binding: SessionGrantBinding) => void;
}

export function SessionGrantPanel({ onBindingChange }: Props) {
  const [authed, setAuthed] = useState(false);
  const { state, tryRecover, recoverViaSignature, generateAndFund, topUp, revoke, getSessionWalletClient } =
    useSessionGrant();
  // Stable ref so onBindingChange closures always read the latest binding.
  const bindingRef = useRef<SessionGrantBinding>({ sessionId: null, getSessionWalletClient });

  // Detect SIWE session on mount AND whenever auth changes elsewhere (the header
  // wallet menu signs in/out via a separate hook instance). Listening to the
  // "keryx:auth" window event makes the panel appear right after sign-in — no reload.
  useEffect(() => {
    let active = true;
    const check = () => {
      fetch("/api/auth/session")
        .then((r) => { if (active) setAuthed(r.ok); })
        .catch(() => { /* network error — leave current state */ });
    };
    check();
    window.addEventListener("keryx:auth", check);
    return () => {
      active = false;
      window.removeEventListener("keryx:auth", check);
    };
  }, []);

  // Propagate binding changes to the parent whenever grant state changes.
  // H1: include the cap so useAskStream can enforce it client-side.
  useEffect(() => {
    const isActive = state.status === "active";
    const activeSessionId = isActive ? state.sessionId : null;
    const binding: SessionGrantBinding = {
      sessionId: activeSessionId,
      getSessionWalletClient,
      grantCap: isActive ? state.cap : undefined,
    };
    bindingRef.current = binding;
    onBindingChange(binding);
  }, [state.status, state.sessionId, state.cap, getSessionWalletClient, onBindingChange]);

  if (!authed) return null;

  return (
    <div className="space-y-2">
      {/* Faucet drip panel — shown when session grant is idle/revoked (user may need USDC first) */}
      {(state.status === "idle" || state.status === "revoked" || state.status === "error") && (
        <FaucetPanel />
      )}
      <GrantSpendDialog
        grantState={state}
        onActivate={generateAndFund}
        onTopUp={topUp}
        onRevoke={revoke}
        onTryRecover={tryRecover}
        onRecoverViaSignature={recoverViaSignature}
      />
    </div>
  );
}
