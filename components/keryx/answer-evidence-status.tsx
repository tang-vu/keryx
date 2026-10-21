"use client";

import { useId } from "react";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { buildAnswerEvidenceStatus, evidenceFollowUpContext, evidenceFollowUpHref, type AnswerEvidenceInput } from "@/lib/research/answer-evidence-status";

export function AnswerEvidenceStatus({ run }: { run: AnswerEvidenceInput }) {
  const copy = useUiMessages();
  const titleId = useId();
  const status = buildAnswerEvidenceStatus(run);
  if (!status.targets.length) return null;

  return <section aria-labelledby={titleId} className="mb-5 border border-line bg-paper-2 px-4 py-3">
    <h3 id={titleId} className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">{copy("reportEvidence.title")}</h3>
    <p className="mt-2 text-sm text-ink">{status.available
      ? copy("reportEvidence.recorded", { count: status.withExcerpts, total: status.targets.length })
      : copy("reportEvidence.unavailable")}</p>
    <p className="mt-1 text-sm text-ink-3">{copy("reportEvidence.notice")}</p>
    {status.needsInspection > 0 && <p className="mt-2 text-sm text-seal">{copy("reportEvidence.inspectCount", { count: status.needsInspection })}</p>}
    <details className="mt-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink">{copy("reportEvidence.inspect")}</summary>
      <ol className="space-y-4">
        {status.targets.map(target => <li key={target.claimIndex} className="border-l-2 border-line pl-3">
          <p className="break-words font-serif text-sm text-ink [overflow-wrap:anywhere]">{target.claim}</p>
          <p className={`mt-1 text-sm ${target.needsInspection ? "text-seal" : "text-ink-3"}`}>
            {!status.available ? copy("reportEvidence.targetUnavailable") : target.excerpts === 0
              ? copy("reportEvidence.missing") : copy("reportEvidence.excerpts", { count: target.excerpts })}
            {status.available && target.estimate !== null ? ` · ${copy("reportReading.estimated", { coverage: Math.round(target.estimate * 100) })}` : ""}
          </p>
          {/* A full navigation ensures even the live ask page rereads its draft URL. */}
          <a href={evidenceFollowUpHref(run.id, copy("reportEvidence.draft", evidenceFollowUpContext(run.question, target.claim)))}
            className="mt-1 inline-flex min-h-11 items-center text-sm text-seal underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-seal">
            {copy("reportEvidence.prepare")}
            <span className="sr-only">: {target.claim}</span>
          </a>
        </li>)}
      </ol>
      <p className="mt-3 text-sm text-ink-3">{copy("reportEvidence.prepareNotice")}</p>
    </details>
  </section>;
}
