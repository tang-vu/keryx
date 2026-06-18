"use client";

/**
 * GrantSpendDialog — the non-custodial spend gate for the browser co-sign flow.
 *
 * Shown above the AskForm when the user is SIWE-authenticated. States:
 *   idle/revoked → "Activate session" button → generateAndFund flow
 *   generating/funding/depositing/registering → progress indicator
 *   active → remaining-cap progress bar + revoke button
 *   error → error message + retry
 *
 * The private session key lives in useSessionGrant's ref — never rendered,
 * never sent to any server endpoint. This component only shows derived state.
 *
 * The revoke flow:
 *   1. Calls revoke() to drop the server grant.
 *   2. Offers to withdraw residual USDC from the Gateway back to the user's
 *      wallet — the user must sign a Gateway withdraw tx in MetaMask.
 *      (We don't auto-withdraw because the session key is gone after revoke;
 *       the user would use a separate Gateway UI to pull remaining funds.)
 */

import { useEffect, useState } from "react";
import type { GrantState } from "@/lib/hooks/use-session-grant";

interface Props {
  grantState: GrantState;
  onActivate: (budgetUsdc: number) => void;
  /** Add more USDC to the currently-active session. */
  onTopUp: (addUsdc: number) => void;
  onRevoke: () => void;
  onTryRecover: () => void;
  /** Re-derive the key from a wallet signature to resume a funded session
   *  (new device / closed tab / after sign-out). Guarantees funds aren't lost. */
  onRecoverViaSignature: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  switching:  "Switch to Arc Testnet in your wallet…",
  generating: "Generating session key…",
  funding:    "Waiting for USDC transfer…",
  depositing: "Depositing to Gateway…",
  confirming: "Confirming Gateway credit (can take up to ~90s)…",
  registering: "Registering grant…",
  recovering: "Recovering session — sign in your wallet…",
};

export function GrantSpendDialog({
  grantState,
  onActivate,
  onTopUp,
  onRevoke,
  onTryRecover,
  onRecoverViaSignature,
}: Props) {
  // Keep the raw text so intermediate states ("", "0.") are typeable; coerce to a
  // number only when activating. (A number state with parseFloat()||0.05 onChange
  // snapped "0."/"" back to 0.05, making the field effectively un-typeable.)
  const [budgetInput, setBudgetInput] = useState("0.05");
  const [showRevoke, setShowRevoke] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpInput, setTopUpInput] = useState("0.05");
  const budgetNum = parseFloat(budgetInput);
  const budgetValid = Number.isFinite(budgetNum) && budgetNum > 0;
  const topUpNum = parseFloat(topUpInput);
  const topUpValid = Number.isFinite(topUpNum) && topUpNum > 0;

  // On mount, offer to recover from sessionStorage (handles page refreshes).
  useEffect(() => {
    onTryRecover();
  }, [onTryRecover]);

  const isWorking = ["switching", "generating", "funding", "depositing", "confirming", "registering", "recovering"].includes(grantState.status);

  if (grantState.status === "active") {
    const spentPct = grantState.cap > 0 ? Math.min(100, (grantState.spent / grantState.cap) * 100) : 0;
    const remaining = Math.max(0, grantState.cap - grantState.spent);

    return (
      <div className="mb-4 border border-seal/40 bg-paper px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {/* green dot = active session */}
            <span className="h-2 w-2 rounded-full bg-paid" />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
              Session active — ${remaining.toFixed(4)} remaining
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setShowTopUp((v) => !v); setShowRevoke(false); }}
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-paid underline underline-offset-2 hover:opacity-80"
            >
              Add funds
            </button>
            <button
              type="button"
              onClick={() => { setShowRevoke(true); setShowTopUp(false); }}
              className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 underline underline-offset-2 hover:text-seal"
            >
              Revoke
            </button>
          </div>
        </div>

        {/* spend progress bar */}
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-seal transition-all"
            style={{ width: `${spentPct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] tracking-widest text-faint">
          <span>${grantState.spent.toFixed(4)} spent</span>
          <span>${grantState.cap.toFixed(4)} cap</span>
        </div>

        {grantState.expiresAt && (
          <div className="mt-1.5 font-mono text-[9px] text-faint">
            Expires {new Date(grantState.expiresAt).toLocaleTimeString()}
          </div>
        )}

        {showTopUp && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              Add
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0.01}
              step={0.01}
              value={topUpInput}
              onChange={(e) => setTopUpInput(e.target.value)}
              className="w-20 border border-ink/30 bg-paper px-2 py-1 font-mono text-[12px] text-ink focus:border-seal focus:outline-none"
            />
            <span className="font-mono text-[10px] text-ink-3">USDC</span>
            <button
              type="button"
              onClick={() => { if (topUpValid) { setShowTopUp(false); onTopUp(topUpNum); } }}
              disabled={!topUpValid}
              className="border border-ink bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_3px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add funds ▸
            </button>
            <span className="w-full font-mono text-[9px] leading-relaxed text-faint">
              One MetaMask tx · deposits into the same session · cap rises after confirm
            </span>
          </div>
        )}

        {showRevoke && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2.5 font-serif text-[13px] leading-snug text-ink-2">
              Revoking stops the agent from spending. Any unspent USDC stays safe
              in the Gateway under your session address{" "}
              {grantState.sessAddr ? (
                <span className="font-mono text-[11px]">{grantState.sessAddr.slice(0, 10)}…</span>
              ) : null}
              {" "}— derived from your wallet, so you can resume it anytime with
              “Recover funded session”. (It is not auto-returned to your wallet.)
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowRevoke(false); onRevoke(); }}
                className="border border-destructive/60 bg-destructive/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-destructive hover:bg-destructive/20"
              >
                Revoke grant
              </button>
              <button
                type="button"
                onClick={() => setShowRevoke(false)}
                className="px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isWorking) {
    return (
      <div className="mb-4 border border-line bg-paper px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-seal" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">
            {STATUS_LABEL[grantState.status] ?? "Working…"}
          </span>
        </div>
      </div>
    );
  }

  // idle / revoked / error → show activation form
  return (
    <div className="mb-4 border border-ink/20 bg-paper-2 px-4 py-3">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
        Non-custodial session
      </div>

      {grantState.status === "error" && grantState.error && (
        <div className="mb-2 border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive">
          {grantState.error}
        </div>
      )}

      <p className="mb-3 max-w-[52ch] font-serif text-[13px] leading-snug text-ink-2">
        Fund a browser-held session key with USDC. The agent buys sources
        automatically — no wallet prompt per source. Your key never leaves
        this tab.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            Budget
          </label>
          <input
            type="number"
            inputMode="decimal"
            min={0.01}
            max={1}
            step={0.01}
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            className="w-20 border border-ink/30 bg-paper px-2 py-1 font-mono text-[12px] text-ink focus:border-seal focus:outline-none"
          />
          <span className="font-mono text-[10px] text-ink-3">USDC</span>
        </div>

        <button
          type="button"
          onClick={() => budgetValid && onActivate(budgetNum)}
          disabled={!budgetValid}
          className="border border-ink bg-ink px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          Activate session ▸
        </button>

        {/* Recover an already-funded session on a new device / after sign-out —
            re-derives the key from a wallet signature (no new funds, no loss). */}
        <button
          type="button"
          onClick={onRecoverViaSignature}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 underline underline-offset-2 hover:text-seal"
        >
          Recover funded session ▸
        </button>
      </div>

      <p className="mt-2 font-mono text-[9px] leading-relaxed tracking-wide text-faint">
        One MetaMask tx to fund · auto-signs per source · funds never lost: sign again on
        any device to recover or withdraw
      </p>
    </div>
  );
}
