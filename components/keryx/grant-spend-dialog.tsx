"use client";

import { useEffect, useState } from "react";
import type { GrantState } from "@/lib/hooks/use-session-grant";
import type { ResearchBudgetOptions } from "@/lib/hooks/use-mainnet-session-grant";
import { SessionActiveCard } from "./session-active-card";
import { UsdcPresetChips } from "./usdc-preset-chips";
import { ResearchBudgetFields, parseBudgetAmount } from "./research-budget-fields";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";

interface Props {
  grantState: GrantState;
  onActivate(budgetUsdc: number, options?: ResearchBudgetOptions): void;
  onTopUp(addUsdc: number): void;
  onExtend(options?: ResearchBudgetOptions): Promise<boolean>;
  onRevoke(): void;
  onTryRecover(): void;
  onRecoverViaSignature(options?: ResearchBudgetOptions): void;
}

const STATUS_LABEL: Record<string, string> = {
  switching: "Switch to " + browserPaymentProfile().label + " in your wallet…",
  generating: "Preparing your research budget…",
  funding: "Review the USDC approval in your wallet…",
  depositing: "Review the USDC deposit in your wallet…",
  confirming: "Checking your deposit with Circle Gateway…",
  registering: "Confirm your research budget in your wallet…",
  recovering: "Recovering your saved budget…",
  restoring: "Restoring saved session in this browser…",
  revoking: "Stopping research spending…",
};

export function GrantSpendDialog({ grantState, onActivate, onTopUp, onExtend, onRevoke, onTryRecover, onRecoverViaSignature }: Props) {
  const mainnet = !browserPaymentProfile().testnet;
  const [budgetInput, setBudgetInput] = useState("0.05");
  const [questionInput, setQuestionInput] = useState("0.05");
  const [durationSeconds, setDurationSeconds] = useState(604800);
  const [resuming, setResuming] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);
  const budget = parseBudgetAmount(budgetInput), question = parseBudgetAmount(questionInput);
  const budgetValid = budget !== null && (!mainnet || (question !== null && question <= budget));
  const options = mainnet && question !== null ? { durationSeconds, questionCapUsdc: question } : undefined;

  useEffect(() => { onTryRecover(); }, [onTryRecover]);

  if (grantState.status === "active") return <SessionActiveCard grantState={grantState}
    onTopUp={onTopUp} onRevoke={onRevoke} onExtend={onExtend} />;

  const working = ["switching", "generating", "funding", "depositing", "confirming", "registering", "recovering", "restoring", "revoking"].includes(grantState.status);
  if (working) return <div className="mb-4 border border-line bg-paper px-4 py-3" role="status">
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 animate-pulse rounded-full bg-seal" />
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">{STATUS_LABEL[grantState.status] ?? "Working…"}</span>
    </div>
    {grantState.status === "registering" && grantState.consentReview && <p className="mt-2 text-xs leading-relaxed text-ink-2">
      Available to authorize: {grantState.consentReview.remainingCapacityUsdc.toFixed(6)} USDC.
      {grantState.consentReview.questionCapUsdc !== undefined && <> Maximum per question: {grantState.consentReview.questionCapUsdc.toFixed(6)} USDC.</>}
      {grantState.consentReview.durationSeconds !== undefined && <> Duration: {grantState.consentReview.durationSeconds / 3600} hours.</>}
      {" "}Previously used or pending amounts remain counted.
    </p>}
    {grantState.status === "confirming" && <p className="mt-2 text-xs leading-relaxed text-ink-2">
      Your deposit is confirmed on-chain. We are checking available Gateway credit. Keep this browser&apos;s saved data;
      recovery checks the original deposit. Confirm the budget when the credit is available.
    </p>}
  </div>;

  const retained = !!grantState.sessAddr;
  return <div className="mb-4 space-y-3 border border-ink/20 bg-paper-2 px-4 py-3">
    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">{mainnet ? "Research budget" : "Non-custodial session"}</div>
    <p className="max-w-[65ch] text-sm leading-relaxed text-ink-2">
      {mainnet ? "Set a budget once and use it across conversations until it expires or runs out. The agent pays for sources within your limits without asking you to sign each payment."
        : "Fund a browser-held session with USDC. The agent pays for sources within your budget."}
    </p>
    {grantState.error && <p role="alert" className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{grantState.error}</p>}

    {retained && <div className="space-y-2 border border-seal/40 bg-paper px-3 py-3">
      <p className="text-xs leading-relaxed text-ink-2">
        Your funded budget is saved in this browser. Reuse it to continue.
        {mainnet && " Renewal keeps the existing total ceiling and previously used or pending amounts."}
      </p>
      <button type="button" disabled={resuming} onClick={async () => {
        setResuming(true); setResumeFailed(false);
        try { if (!await onExtend()) setResumeFailed(true); }
        catch { setResumeFailed(true); }
        finally { setResuming(false); }
      }} className="border border-ink bg-ink px-4 py-2 font-mono text-[11px] text-cream disabled:opacity-50">
        {resuming ? "Recovering…" : mainnet ? "Continue with saved budget" : "Resume session ▸"}
      </button>
      {resumeFailed && <p role="alert" className="text-xs text-destructive">Recovery did not complete. Keep your saved browser data and retry when your wallet and Gateway are available.</p>}
    </div>}

    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="research-total-budget" className="text-xs text-ink-2">{retained ? "New budget allowance" : "Total budget"} (USDC)</label>
      <UsdcPresetChips value={budgetInput} onPick={setBudgetInput} />
      <input id="research-total-budget" type="text" inputMode="decimal" value={budgetInput}
        onChange={event => setBudgetInput(event.target.value)}
        className="w-24 border border-ink/30 bg-paper px-3 py-2 font-mono text-xs text-ink focus:border-seal focus:outline-none" />
    </div>
    {mainnet && <ResearchBudgetFields questionInput={questionInput} onQuestionChange={setQuestionInput}
      durationSeconds={durationSeconds} onDurationChange={setDurationSeconds} />}
    {mainnet && budget !== null && question !== null && question > budget && <p role="alert" className="text-xs text-destructive">The per-question maximum must fit within the total budget.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={!budgetValid || resuming} onClick={() => { if (budgetValid && budget !== null) onActivate(budget, options); }}
        className="border border-ink bg-ink px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cream disabled:cursor-not-allowed disabled:opacity-50">
        {mainnet ? retained ? "Review new budget" : "Enable research budget" : "Activate session ▸"}
      </button>
      {!retained && <button type="button" onClick={() => onRecoverViaSignature()} className="text-xs text-ink-3 underline underline-offset-2">
        {mainnet ? "Recover a saved budget" : "Recover funded session ▸"}
      </button>}
    </div>
    <p className="max-w-[75ch] text-[11px] leading-relaxed text-ink-3">
      {mainnet ? "First-time funding needs wallet approval and a deposit, followed by budget confirmation. Reloading or opening another conversation keeps your limits. Native gas is extra. Logout retains your encrypted budget; clearing browser data or losing this device can lose access to its funds."
        : "Fund your session and confirm its allowance. Existing testnet recovery remains available."}
    </p>
  </div>;
}