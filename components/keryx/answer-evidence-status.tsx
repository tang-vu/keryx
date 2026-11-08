"use client";

import { useId } from "react";
import { UiMessage, useUiMessages } from "@/lib/i18n/ui-copy";
import { boundedEvidenceFollowUpDraft, buildAnswerEvidenceStatus, evidenceFollowUpContext, evidenceFollowUpHref, type AnswerEvidenceInput } from "@/lib/research/answer-evidence-status";

export function AnswerEvidenceStatus({ run, allowPublicFollowUp = false, onPrepareFollowUp }: {
  run: AnswerEvidenceInput; allowPublicFollowUp?: boolean; onPrepareFollowUp?: (draft: string) => void;
}) {
  const copy = useUiMessages();
  const titleId = useId();
  const status = buildAnswerEvidenceStatus(run);
  if (!status.targets.length && !status.finalAssessment) return null;

  return <section aria-labelledby={titleId} className="mb-5 border border-line bg-paper-2 px-4 py-3">
    <h3 id={titleId} className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink"><UiMessage messageKey="reportEvidence.title" /></h3>
    {status.targets.length > 0 && <p className="mt-2 text-sm text-ink">{status.available
      ? <UiMessage messageKey="reportEvidence.recorded" values={{ count: status.withExcerpts, total: status.targets.length }} />
      : <UiMessage messageKey="reportEvidence.unavailable" />}</p>}
    <p className="mt-1 text-sm text-ink-3"><UiMessage messageKey="reportEvidence.notice" /></p>
    {status.needsInspection > 0 && <p className="mt-2 text-sm text-seal"><UiMessage messageKey="reportEvidence.inspectCount" values={{ count: status.needsInspection }} /></p>}
    {status.finalAssessment && <div role="note" aria-label={copy("decisionPhase.sufficiency")} className="mt-3 border-l-2 border-line pl-3">
      <p lang="und" dir="auto" className="whitespace-pre-wrap font-serif text-sm text-ink [overflow-wrap:anywhere]">{status.finalAssessment.message}</p>
    </div>}
    {status.targets.length > 0 && <details className="mt-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink"><UiMessage messageKey="reportEvidence.inspect" /></summary>
      <ol className="space-y-4">
        {status.targets.map(target => <li key={target.claimIndex} className="border-l-2 border-line pl-3">
          <p className="break-words font-serif text-sm text-ink [overflow-wrap:anywhere]">{target.claim}</p>
          <p className={`mt-1 text-sm ${target.needsInspection ? "text-seal" : "text-ink-3"}`}>
            {!status.available ? <UiMessage messageKey="reportEvidence.targetUnavailable" /> : target.excerpts === 0
              ? <UiMessage messageKey="reportEvidence.missing" /> : <UiMessage messageKey="reportEvidence.excerpts" values={{ count: target.excerpts }} />}
            {status.available && target.estimate !== null ? <> · <UiMessage messageKey="reportReading.estimated" values={{ coverage: Math.round(target.estimate * 100) }} /></> : ""}
          </p>
          {/* Only an explicitly public context may put report text in a URL. */}
          {allowPublicFollowUp ? <a href={evidenceFollowUpHref(run.id, copy("reportEvidence.draft", evidenceFollowUpContext(run.question, target.claim)))}
            className="mt-1 inline-flex min-h-11 items-center text-sm text-seal underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-seal">
            <UiMessage messageKey="reportEvidence.prepare" />
            <span className="sr-only">: {target.claim}</span>
          </a> : <button type="button" disabled={!onPrepareFollowUp}
            onClick={() => onPrepareFollowUp?.(boundedEvidenceFollowUpDraft(copy("reportEvidence.draft", evidenceFollowUpContext(run.question, target.claim))))}
            className="mt-1 inline-flex min-h-11 items-center text-start text-sm text-seal underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-50">
            <UiMessage messageKey="reportEvidence.prepare" />
            <span className="sr-only">: {target.claim}</span>
          </button>}
        </li>)}
      </ol>
      <p className="mt-3 text-sm text-ink-3"><UiMessage messageKey="reportEvidence.prepareNotice" /></p>
    </details>}
  </section>;
}
