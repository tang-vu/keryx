"use client";
import { selectPlural } from "@/lib/i18n/format";

import { DisplayTime } from "@/components/keryx/display-time";


import type { QueryRun, PaymentRecord } from "@/lib/types";
import type { PresentationLanguage } from "@/shared/i18n/presentation-language";
import { ReasoningConsole } from "@/components/keryx/reasoning-console";
import { CreatorsPaidPanel } from "@/components/keryx/creators-paid-panel";
import { AnswerCard } from "@/components/keryx/answer-card";
import { ConfidenceBadge } from "@/components/keryx/confidence-badge";
import { deriveConfidence } from "@/lib/agent/confidence";
import { projectBibliographicTask } from "@/lib/research/bibliographic-task-result";
import { DecisionReviews } from "@/components/keryx/decision-reviews";
import { ReadCheckpointVerify } from "@/components/keryx/read-checkpoint-verify";
import { projectActualReadCheckpoints } from "@/lib/research-audit/actual-read-projection";
import { useUiCopy, useUiMessages } from "@/lib/i18n/ui-copy";
import { walkthroughMessages as englishWalkthroughMessages } from "@/locales/en/walkthrough";
import { ResearchRecovery } from "@/components/keryx/research-recovery";
import type { RunVisibility } from "@/lib/run-privacy/contracts";


export function DispatchView({
  run,
  answerLanguage,
  payments,
  historical = false,
  historicalNetwork,
  visibility,
  recoveryWallet = null,
}: {
  run: QueryRun;
  /** Trusted stored-answer language, read on the server before public projection. */
  answerLanguage?: PresentationLanguage;
  payments: PaymentRecord[];
  historical?: boolean;
  historicalNetwork?: string;
  visibility?: RunVisibility;
  recoveryWallet?: string | null;
}) {
  const copy = useUiMessages();
  const walkthroughMessages = useUiCopy("walkthrough", englishWalkthroughMessages);
  const bibliography = projectBibliographicTask(run.bibliography);
  const confidence = bibliography ? null : deriveConfidence(run);
  const mode = run.paymentMode ?? null;
  const recordedNetwork = historical ? historicalNetwork ?? "unknown" : undefined;
  const readCheckpoints = historical ? null : projectActualReadCheckpoints(run);

  return (
    <>
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
        {copy("reportDispatchView.archived")}
      </div>
      <div className="mb-7 max-w-[860px]">
        <p lang="und" className="font-serif text-[clamp(17px,1.5vw,20px)] leading-[1.55] text-ink-2">
          {run.question}
        </p>
        {run.id === "b144ef47-c2f5-46ec-bdb7-e62bc1314913" ? <p className="mt-3 text-sm leading-relaxed text-ink-3">{walkthroughMessages.limitation}</p> : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          {bibliography ? <span className="text-xs text-ink-3">{copy("reportDispatchView.bibliography")}</span> : confidence ? <ConfidenceBadge confidence={confidence} showReason /> : null}
          <p className="font-mono text-[10px] text-ink-3">
            {<DisplayTime value={run.createdAt} />} · {run.engine}
          </p>
        </div>
      </div>

      {!historical && visibility && <ResearchRecovery question={run.question} budget={run.budget} parentId={run.id} visibility={visibility} expectedWallet={recoveryWallet} />}

      <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,330px)]">
        <AnswerCard run={run} answerLanguage={answerLanguage} meta={null} payments={payments} showFeedback={!historical} historicalNetwork={recordedNetwork} />
        <aside className="min-w-0 lg:sticky lg:top-6" aria-label={copy("reportDispatchView.paymentEvidence")}>
          <CreatorsPaidPanel payments={payments} mode={mode} streaming={false} historicalNetwork={recordedNetwork} />
        </aside>
      </div>

      <details className="group mt-8 border border-line bg-paper">
        <summary className="cursor-pointer px-5 py-4 font-mono text-xs uppercase tracking-widest text-ink focus-visible:outline-2 focus-visible:outline-seal">
          {copy(selectPlural(run.trace.length) === "one" ? "reportDispatchView.steps.one" : "reportDispatchView.steps.other", { count: run.trace.length })}
        </summary>
        <div className="border-t border-line p-4">
          <ReasoningConsole steps={run.trace} streaming={false} budget={run.budget} />
        </div>
      </details>
      {!historical && <DecisionReviews runId={run.id} />}
      <ReadCheckpointVerify key={readCheckpoints?.retainedDigest ?? "unavailable"} capture={readCheckpoints} />
    </>
  );
}
