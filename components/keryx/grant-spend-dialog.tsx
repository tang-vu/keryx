"use client";

/**
 * GrantSpendDialog — the non-custodial spend gate for the browser co-sign flow.
 *
 * Shown above the AskForm when the user is SIWE-authenticated. States:
 *   idle/revoked → "Activate session" button → generateAndFund flow
 *   generating/funding/depositing/registering → progress indicator
 *   active → SessionActiveCard (cap bar, countdown, extend, top-up, revoke)
 *   expired → one-click resume (worker still holds the key) + signature recovery
 *   error → error message + retry
 *
 * The private session key lives in the signer worker — never rendered, never
 * sent to any server endpoint. This component only shows derived state.
 */

import { useEffect, useState } from "react";
import type { GrantState } from "@/lib/hooks/use-session-grant";
import { SessionActiveCard } from "@/components/keryx/session-active-card";
import { UsdcPresetChips } from "@/components/keryx/usdc-preset-chips";

interface Props {
  grantState: GrantState;
  onActivate: (budgetUsdc: number) => void;
  /** Add more USDC to the currently-active session. */
  onTopUp: (addUsdc: number) => void;
  /** Fresh TTL for the current session — one API call, no wallet interaction. */
  onExtend: () => Promise<boolean>;
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
  confirming: "Deposit confirming on Circle Gateway — activates automatically…",
  registering: "Registering grant…",
  recovering: "Recovering session — sign in your wallet…",
};

export function GrantSpendDialog({
  grantState,
  onActivate,
  onTopUp,
  onExtend,
  onRevoke,
  onTryRecover,
  onRecoverViaSignature,
}: Props) {
  // Keep the raw text so intermediate states ("", "0.") are typeable; coerce to a
  // number only when activating. (A number state with parseFloat()||0.05 onChange
  // snapped "0."/"" back to 0.05, making the field effectively un-typeable.)
  const [budgetInput, setBudgetInput] = useState("0.05");
  const [resuming, setResuming] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);
  const budgetNum = parseFloat(budgetInput);
  const budgetValid = Number.isFinite(budgetNum) && budgetNum > 0;

  // On mount, offer to recover from sessionStorage (handles page refreshes).
  useEffect(() => {
    onTryRecover();
  }, [onTryRecover]);

  const isWorking = ["switching", "generating", "funding", "depositing", "confirming", "registering", "recovering"].includes(grantState.status);

  if (grantState.status === "active") {
    return (
      <SessionActiveCard
        grantState={grantState}
        onTopUp={onTopUp}
        onRevoke={onRevoke}
        onExtend={onExtend}
      />
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
        {grantState.status === "confirming" && (
          // Reassure: the deposit is on-chain and safe; activation is hands-off and
          // survives a reload, so the user can relax or keep browsing.
          <p className="mt-2 font-serif text-[12.5px] leading-snug text-ink-2">
            Your deposit is settling through Circle Gateway (usually under a minute).
            The session activates on its own — you can keep this page open or even
            reload; it picks up automatically. Your funds are safe on-chain.
          </p>
        )}
      </div>
    );
  }

  // idle / revoked / expired / error → show activation form
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

      {grantState.status === "expired" && (
        <div className="mb-2 border border-seal/40 bg-paper px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] leading-relaxed text-ink-2">
              Session expired — your USDC is safe in the Gateway.
            </span>
            {/* The signer worker outlives the grant in this tab, so resuming is one
                API call — no signature. Signature recovery stays as the fallback. */}
            <button
              type="button"
              onClick={async () => {
                setResuming(true);
                setResumeFailed(false);
                const ok = await onExtend();
                if (!ok) setResumeFailed(true);
                setResuming(false);
              }}
              disabled={resuming}
              className="border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_3px_0_var(--seal)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resuming ? "Resuming…" : "Resume session ▸"}
            </button>
          </div>
          <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-faint">
            {resumeFailed
              ? "Could not resume from this tab — use “Recover funded session” below (one signature, no gas)."
              : "One click, no signature — or recover with a signature on any device."}
          </p>
        </div>
      )}

      <p className="mb-3 max-w-[52ch] font-serif text-[13px] leading-snug text-ink-2">
        Fund a browser-held session key with USDC. The agent buys sources
        automatically — no wallet prompt per source. Your key never leaves
        this tab.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            Budget
          </label>
          <UsdcPresetChips value={budgetInput} onPick={setBudgetInput} />
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
            re-derives the key in the worker from a wallet signature (no new funds, no loss). */}
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
