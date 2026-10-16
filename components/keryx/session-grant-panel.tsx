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
import { CircleGoogleWalletButton } from "./circle-google-wallet";
import { FaucetPanel } from "@/components/keryx/faucet-panel";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { SessionCashoutPanel } from "./session-cashout-panel";
import Link from "next/link";
import { formatAmount, recordedUsdcMicros } from "@/lib/i18n/format";
import { walletWorkspaceMessages as copy } from "@/locales/en/wallet-workspace";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_copy = copy;


export interface SessionGrantBinding {
  /** Retained sessionId for active, expired or paused grants; never fall back implicitly. */
  sessionId: string | null;
  /** Returns the session WalletClient for auto-signing, or null. */
  getSessionWalletClient: () => WalletClient | null;
  authorizeSessionPayment?: (reqId: string, question: import("@/lib/session/browser-session-runtime").BrowserQuestionBudget) => Promise<string>;
  /**
   * The funded grant cap in USDC, or undefined when no grant is active.
   * Passed into useAskStream so the browser enforces its own spend ceiling
   * independently of any server-side guard.
   */
  grantCap?: number;
  /** The owner-signed maximum for each research question. */
  questionCapUsdc?: number;
  /** True when a known session has lapsed (TTL) — UI should prompt recovery. */
  expired?: boolean;
  /** Status could not be confirmed; retain the session and block new questions. */
  paused?: boolean;
  /** Flip the grant to "expired"; called by the ask stream on a 401 session_expired. */
  markExpired?: () => void;
}

interface Props {
  /** Called whenever the grant binding changes (auth state or grant activation). */
  onBindingChange?: (binding: SessionGrantBinding) => void;
  variant?: "chat" | "wallet";
}

export function SessionGrantPanel({ onBindingChange, variant = "chat" }: Props) {
  const copy = useUiCopy("wallet-workspace", uiEnglish_copy);
  const [authed, setAuthed] = useState(false);
  const { state, tryRecover, recoverViaSignature, generateAndFund, topUp, extend, revoke, getSessionWalletClient, markExpired, authorizeSessionPayment } =
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
  // Include the cap so useAskStream can enforce it client-side.
  useEffect(() => {
    const isActive = state.status === "active";
    const isExpired = state.status === "expired";
    const isPaused = state.status === "paused" || (!browserPaymentProfile().testnet && !!state.sessionId && !isActive && !isExpired);
    // Keep sessionId flowing while expired so an ask still reaches the server and gets
    // a clean 401 session_expired (rather than silently using the treasury). The cap is
    // only meaningful while active — it gates client-side signing. Unknown status retains
    // its identity with an explicit paused binding so the consumer blocks new questions.
    const binding: SessionGrantBinding = {
      sessionId: isActive || isExpired || isPaused ? state.sessionId : null,
      getSessionWalletClient,
      authorizeSessionPayment,
      grantCap: isActive ? state.cap : undefined,
      questionCapUsdc: isActive ? state.researchBudget?.questionCapUsdc : undefined,
      expired: isExpired,
      paused: isPaused,
      markExpired,
    };
    bindingRef.current = binding;
    onBindingChange?.(binding);
  }, [state.status, state.sessionId, state.cap, state.researchBudget?.questionCapUsdc, getSessionWalletClient, markExpired, authorizeSessionPayment, onBindingChange]);

  if (!authed) return null;

  const budgetControls = <>
      <CircleGoogleWalletButton reconnectOnly />
      {/* Faucet drip panel — shown when session grant is idle/revoked (user may need USDC first) */}
      {variant === "chat" && browserPaymentProfile().testnet && (state.status === "idle" || state.status === "revoked" || state.status === "error") && (
        <FaucetPanel />
      )}
      <GrantSpendDialog
        grantState={state}
        onActivate={(amount, options) => generateAndFund(amount, false, options)}
        onTopUp={topUp}
        onExtend={extend}
        onRevoke={revoke}
        onTryRecover={tryRecover}
        onRecoverViaSignature={recoverViaSignature}
      />
  </>;

  if (variant === "wallet") return <div className="space-y-6">
    <section id="agent-budget" className="scroll-mt-6 space-y-4 border border-line bg-paper-2 p-4 sm:p-6">
      <div><h2 className="font-display text-2xl">{copy.budget}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">{copy.budgetDescription}</p></div>
      {budgetControls}
    </section>
    {!browserPaymentProfile().testnet && <section id="withdraw" className="scroll-mt-6 space-y-4 border border-line bg-paper-2 p-4 sm:p-6">
      <div><h2 className="font-display text-2xl">{copy.withdraw}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">{copy.withdrawDescription}</p></div>
      <SessionCashoutPanel sessAddr={state.sessAddr} expanded/>
    </section>}
  </div>;

  const active = state.status === "active";
  const cap = recordedUsdcMicros(state.cap), spent = recordedUsdcMicros(state.spent);
  const remaining = cap === null || spent === null ? null : cap > spent ? cap - spent : BigInt(0);
  const label = active ? copy.ready : state.status === "expired" ? copy.expired
    : state.status === "paused" || state.status === "error" ? copy.paused
    : ["restoring", "recovering", "registering", "funding", "depositing", "confirming", "switching", "generating", "revoking"].includes(state.status) ? copy.checkingBudget : copy.noBudget;
  return <section aria-label={copy.walletAndBudget} className="space-y-2 border border-line bg-paper px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={active ? "text-paid" : "text-ink-2"}>{label}</span>
        {active && <span className="font-mono text-ink" aria-label={copy.remaining}>{formatAmount(remaining, { minimumFractionDigits: 6, useGrouping: false })} {copy.usdc}</span>}
      </div>
      <Link href="/me/wallet" className="inline-flex min-h-11 items-center text-xs underline underline-offset-4">{copy.walletAndBudget}</Link>
    </div>
    {active && <p className="text-[11px] leading-relaxed text-ink-3">{copy.budgetBoundary}</p>}
    <details>
      <summary className="min-h-11 cursor-pointer py-3 text-xs text-ink-2 underline underline-offset-4">{active ? copy.manageBudget : copy.budgetSetup}</summary>
      <div className="space-y-2 pt-2">{budgetControls}</div>
    </details>
  </section>;
}
