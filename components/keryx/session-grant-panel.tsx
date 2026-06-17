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
  const { state, tryRecover, generateAndFund, revoke, getSessionWalletClient } = useSessionGrant();
  // Stable ref so onBindingChange closures always read the latest binding.
  const bindingRef = useRef<SessionGrantBinding>({ sessionId: null, getSessionWalletClient });

  // Detect SIWE session once on mount — GET /api/auth/session returns 401 if unauthed.
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => {
        if (r.ok) setAuthed(true);
      })
      .catch(() => { /* network error — not authed */ });
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
    <GrantSpendDialog
      grantState={state}
      onActivate={generateAndFund}
      onRevoke={revoke}
      onTryRecover={tryRecover}
    />
  );
}
