"use client";

import { useEffect, useState } from "react";
import type { GrantState } from "@/lib/hooks/use-session-grant";
import type { ResearchBudgetOptions } from "@/lib/hooks/use-mainnet-session-grant";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { UsdcPresetChips } from "./usdc-preset-chips";
import { parseBudgetAmount } from "./research-budget-fields";

interface Props {
  grantState: GrantState;
  onTopUp(addUsdc: number): void;
  onRevoke(): void;
  onExtend(options?: ResearchBudgetOptions): Promise<boolean>;
}

function useRemainingMs(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return expiresAt ? new Date(expiresAt).getTime() - now : null;
}
function formatRemaining(ms: number) {
  if (ms <= 0) return "expired";
  if (ms < 60_000) return "under a minute";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return minutes + " min";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h " + (minutes % 60) + "m";
  return Math.floor(hours / 24) + "d " + (hours % 24) + "h";
}

export function SessionActiveCard({ grantState, onTopUp, onRevoke, onExtend }: Props) {
  const mainnet = !browserPaymentProfile().testnet;
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpInput, setTopUpInput] = useState("0.05");
  const [extending, setExtending] = useState(false);
  const [extendFailed, setExtendFailed] = useState(false);
  const topUpAmount = parseBudgetAmount(topUpInput);
  const remainingMs = useRemainingMs(grantState.expiresAt);
  const remaining = Math.max(0, grantState.cap - grantState.spent);
  const spentPct = grantState.cap > 0 ? Math.max(0, Math.min(100, grantState.spent / grantState.cap * 100)) : 0;

  return <div className="mb-4 space-y-2 border border-seal/40 bg-paper px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-paid" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
          {mainnet ? "Research budget" : "Session active"} — {remaining.toFixed(6)} USDC remaining
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setShowTopUp(value => !value)}
          className="text-xs text-paid underline underline-offset-2">Add to budget</button>
        <button type="button" onClick={onRevoke}
          className="border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
          Stop spending
        </button>
      </div>
    </div>
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
      <div className="h-full rounded-full bg-seal transition-all" style={{ width: spentPct + "%" }} />
    </div>
    <div className="flex flex-wrap justify-between gap-2 font-mono text-[10px] text-ink-3">
      <span>{grantState.spent.toFixed(6)} USDC {mainnet ? "used or held" : "spent"}</span>
      <span>{grantState.cap.toFixed(6)} USDC ceiling</span>
    </div>
    {grantState.researchBudget && <p className="text-xs text-ink-2">
      Maximum per question: {grantState.researchBudget.questionCapUsdc.toFixed(6)} USDC.
      {" "}Shared across your conversations.
    </p>}
    {remainingMs !== null && <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-ink-3">Budget {remainingMs <= 0 ? "expired" : "expires in " + formatRemaining(remainingMs)}</span>
      <button type="button" disabled={extending} onClick={async () => {
        setExtending(true); setExtendFailed(false);
        try { if (!await onExtend()) setExtendFailed(true); }
        catch { setExtendFailed(true); }
        finally { setExtending(false); }
      }} className="text-xs text-ink-3 underline underline-offset-2 disabled:opacity-50">
        {extending ? "Renewing…" : mainnet ? "Renew duration" : "Extend session ▸"}
      </button>
    </div>}
    {extendFailed && <p role="alert" className="text-xs text-destructive">Renewal did not complete. Your saved budget and prior payments remain recorded.</p>}
    {mainnet && <p className="text-[11px] leading-relaxed text-ink-3">
      Pending payments count against the remaining budget. Renewal keeps the existing ceiling.
      Stopping blocks new payments; funds stay in Gateway for your withdrawal.
    </p>}
    {showTopUp && <div className="space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="research-budget-add" className="text-xs text-ink-2">Add (USDC)</label>
        <UsdcPresetChips value={topUpInput} onPick={setTopUpInput} />
        <input id="research-budget-add" type="text" inputMode="decimal" value={topUpInput}
          onChange={event => setTopUpInput(event.target.value)}
          className="w-24 border border-ink/30 bg-paper px-3 py-2 font-mono text-xs text-ink focus:border-seal focus:outline-none" />
        <button type="button" disabled={topUpAmount === null} onClick={() => {
          if (topUpAmount !== null) { setShowTopUp(false); onTopUp(topUpAmount); }
        }} className="border border-ink bg-ink px-4 py-2 font-mono text-xs text-cream disabled:opacity-50">
          Review increase
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-3">
        {mainnet ? "Review funding and a new budget confirmation before the ceiling increases. Your per-question maximum stays the same. Native gas is extra."
          : "Deposit into your existing testnet session and confirm its new allowance."}
      </p>
    </div>}
  </div>;
}