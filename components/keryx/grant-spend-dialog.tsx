"use client";

import { createMessages } from "@/lib/i18n/messages";
import { useEffect, useState } from "react";
import type { GrantState } from "@/lib/hooks/use-session-grant";
import type { ResearchBudgetOptions } from "@/lib/hooks/use-mainnet-session-grant";
import { SessionActiveCard } from "./session-active-card";
import { UsdcPresetChips } from "./usdc-preset-chips";
import { ResearchBudgetFields, parseBudgetAmount } from "./research-budget-fields";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";

const copy = createMessages("en");

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
  switching: copy("budgetGrant.switchNetwork", { network: browserPaymentProfile().label }),
  generating: copy("budgetGrant.preparing"),
  funding: copy("budgetGrant.reviewApproval"),
  depositing: copy("budgetGrant.reviewDeposit"),
  confirming: copy("budgetGrant.checkingCredit"),
  registering: copy("budgetGrant.confirmBudget"),
  recovering: copy("budgetGrant.recoveringBudget"),
  restoring: copy("budgetGrant.restoring"),
  revoking: copy("budgetGrant.stopping"),
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
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">{STATUS_LABEL[grantState.status] ?? copy("budgetGrant.working")}</span>
    </div>
    {grantState.status === "registering" && grantState.consentReview && <p className="mt-2 text-xs leading-relaxed text-ink-2">
      {grantState.consentReview.durationSeconds !== undefined
        ? grantState.consentReview.questionCapUsdc !== undefined
          ? copy("budgetGrant.consentCapDuration", { amount: grantState.consentReview.remainingCapacityUsdc.toFixed(6), cap: grantState.consentReview.questionCapUsdc.toFixed(6), duration: copy(grantState.consentReview.durationSeconds / 3600 === 1 ? "budgetGrant.duration.one" : "budgetGrant.duration.other", { count: grantState.consentReview.durationSeconds / 3600 }) })
          : copy("budgetGrant.consentDuration", { amount: grantState.consentReview.remainingCapacityUsdc.toFixed(6), duration: copy(grantState.consentReview.durationSeconds / 3600 === 1 ? "budgetGrant.duration.one" : "budgetGrant.duration.other", { count: grantState.consentReview.durationSeconds / 3600 }) })
        : grantState.consentReview.questionCapUsdc !== undefined
          ? copy("budgetGrant.consentCap", { amount: grantState.consentReview.remainingCapacityUsdc.toFixed(6), cap: grantState.consentReview.questionCapUsdc.toFixed(6) })
          : copy("budgetGrant.consent", { amount: grantState.consentReview.remainingCapacityUsdc.toFixed(6) })}
    </p>}
    {grantState.status === "confirming" && <p className="mt-2 text-xs leading-relaxed text-ink-2">
      {copy("budgetGrant.confirmingNotice")}
    </p>}
  </div>;

  const retained = !!grantState.sessAddr;
  return <div className="mb-4 space-y-3 border border-ink/20 bg-paper-2 px-4 py-3">
    <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">{mainnet ? copy("budgetGrant.mainnetTitle") : copy("budgetGrant.testnetTitle")}</div>
    <p className="max-w-[65ch] text-sm leading-relaxed text-ink-2">
      {mainnet ? copy("budgetGrant.mainnetIntroduction")
        : copy("budgetGrant.testnetIntroduction")}
    </p>
    {grantState.error && <p role="alert" className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{grantState.error}</p>}

    {retained && <div className="space-y-2 border border-seal/40 bg-paper px-3 py-3">
      <p className="text-xs leading-relaxed text-ink-2">
        {copy(mainnet ? "budgetGrant.savedMainnet" : "budgetGrant.savedTestnet")}
      </p>
      <button type="button" disabled={resuming} onClick={async () => {
        setResuming(true); setResumeFailed(false);
        try { if (!await onExtend()) setResumeFailed(true); }
        catch { setResumeFailed(true); }
        finally { setResuming(false); }
      }} className="border border-ink bg-ink px-4 py-2 font-mono text-[11px] text-cream disabled:opacity-50">
        {resuming ? copy("budgetGrant.recovering") : mainnet ? copy("budgetGrant.continue") : copy("budgetGrant.resume")}
      </button>
      {resumeFailed && <p role="alert" className="text-xs text-destructive">{copy("budgetGrant.recoveryFailed")}</p>}
    </div>}

    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="research-total-budget" className="text-xs text-ink-2">{copy(retained ? "budgetGrant.newAllowance" : "budgetGrant.total")}</label>
      <UsdcPresetChips value={budgetInput} onPick={setBudgetInput} />
      <input id="research-total-budget" type="text" inputMode="decimal" value={budgetInput}
        onChange={event => setBudgetInput(event.target.value)}
        className="w-24 border border-ink/30 bg-paper px-3 py-2 font-mono text-xs text-ink focus:border-seal focus:outline-none" />
    </div>
    {mainnet && <ResearchBudgetFields questionInput={questionInput} onQuestionChange={setQuestionInput}
      durationSeconds={durationSeconds} onDurationChange={setDurationSeconds} />}
    {mainnet && budget !== null && question !== null && question > budget && <p role="alert" className="text-xs text-destructive">{copy("budgetGrant.questionCapTooHigh")}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={!budgetValid || resuming} onClick={() => { if (budgetValid && budget !== null) onActivate(budget, options); }}
        className="border border-ink bg-ink px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-cream disabled:cursor-not-allowed disabled:opacity-50">
        {mainnet ? retained ? copy("budgetGrant.reviewNew") : copy("budgetGrant.enable") : copy("budgetGrant.activate")}
      </button>
      {!retained && <button type="button" onClick={() => onRecoverViaSignature()} className="text-xs text-ink-3 underline underline-offset-2">
        {mainnet ? copy("budgetGrant.recoverSaved") : copy("budgetGrant.recoverFunded")}
      </button>}
    </div>
    <p className="max-w-[75ch] text-[11px] leading-relaxed text-ink-3">
      {mainnet ? copy("budgetGrant.mainnetFundingNotice")
        : copy("budgetGrant.testnetFundingNotice")}
    </p>
  </div>;
}