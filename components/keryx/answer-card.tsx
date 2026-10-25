"use client";
import { formatRecordedUsdc, selectPlural } from "@/lib/i18n/format";



import { demoteSyntheticEvidence } from "@/lib/research/evidence-provenance";

/**
 * §II · The reading — the grounded answer set as a printed page: Spectral body
 * with footnote citation markers, a footnotes apparatus where each one pays its
 * author, and a settlement strip (spent / % to creators / decisions / engine).
 * When a permalink URL is available, a Share button copies it to the clipboard.
 */

import { useState, useCallback, useRef } from "react";
import type { QueryRun, PaymentRecord } from "@/lib/types";
import type { PresentationLanguage } from "@/shared/i18n/presentation-language";
import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import { AnswerMarkdown } from "./answer-markdown";
import { AnswerFeedback } from "./answer-feedback";
import { RequesterFeedback } from "./requester-feedback";
import { ScholarlyMetadataDetails } from "./scholarly-metadata";
import { ModeBadge } from "./mode-badge";
import { recordedArcLabel } from "@/lib/arc-network-display";
import { SectionHeading } from "./banknote";
import { ConfidenceBadge } from "./confidence-badge";
import { deriveConfidence } from "@/lib/agent/confidence";
import { cn } from "@/lib/utils";
import { CitationEvidencePanel } from "./citation-evidence-panel";
import { ResearchCitationExport } from "./research-citation-export";
import { EvidenceMatrixExport } from "./evidence-matrix-export";
import { SourceEvidenceLens } from "./source-evidence-lens";
import { PdfReadingScope } from "./pdf-reading-scope";
import { reasoningOutputLimitText } from "@/lib/llm/reasoning-telemetry";
import { projectBibliographicTask } from "@/lib/research/bibliographic-task-result";
import { BibliographyExports } from "./bibliography-exports";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { sourceReadSummary } from "@/lib/research/source-read-outcomes";
import { AnswerEvidenceStatus } from "./answer-evidence-status";





export function AnswerCard({ run, answerLanguage, meta, permalink, payments = [], showFeedback = true, historicalNetwork }: { run: QueryRun; answerLanguage?: PresentationLanguage; meta: AskMeta | null; permalink?: string; payments?: PaymentRecord[]; showFeedback?: boolean; historicalNetwork?: string }) {
  const copy = useUiMessages();
  const originalAnswer = run.answer;
  run = demoteSyntheticEvidence(run);
  // A read projection that changes prose invalidates the recorded final bytes.
  const generatedProseLanguage = run.answer === originalAnswer ? answerLanguage : undefined;
  const bibliography = projectBibliographicTask(run.bibliography);
  const [highlight, setHighlight] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const openCitation = useCallback((marker: string, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setHighlight(marker);
  }, []);
  const closeCitation = useCallback(() => {
    setHighlight(null);
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);
  const selectedCitation = run.citations.find((citation) => citation.marker === highlight);
  const bought = run.decisions.filter((d) => d.action === "BUY").length;
  const skipped = run.decisions.filter((d) => d.action === "SKIP").length;
  const reads = sourceReadSummary(run);
  const confidence = deriveConfidence(run);
  const outputLimit = reasoningOutputLimitText(run.reasoningAttempts, /[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/u.test(run.question) ? "vi" : "en", run.trace);

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500">
      <SectionHeading numeral="II" label={copy("reportReading.title")} right={bibliography ? copy("reportReading.metadataOnly") : copy(selectPlural(run.citations.length) === "one" ? "reportReading.cited.one" : "reportReading.cited.other", { count: run.citations.length })} />
      {bibliography ? <p className="mb-4 text-sm text-ink-3">{copy("reportReading.bibliographyNotice")}</p> : confidence ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <ConfidenceBadge confidence={confidence} showReason sourceGrounding={run.citations.some(citation => Boolean(citation.webProvenance))} />
          <span className="border border-line bg-paper-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            {copy("reportReading.mode", { mode: run.researchMode ?? meta?.researchMode ?? "deep" })}
          </span>
          {run.previewCoverage ? (
            <span className="font-mono text-[10px] text-ink-3">
              {copy(selectPlural(run.previewCoverage.totalClaims) === "one" ? "reportReading.preview.one" : "reportReading.preview.other", { covered: run.previewCoverage.coveredClaims, count: run.previewCoverage.totalClaims })}
            </span>
          ) : null}
          {run.evidencePortfolio ? (
            <span
              className="font-mono text-[10px] text-ink-3"
              title={copy("reportEvidence.selectionNotice")}
            >
              {copy("reportEvidence.selection", { selected: run.evidencePortfolio.selectedAssetIds.length, eligible: run.evidencePortfolio.eligibleCandidates })}
            </span>
          ) : null}
        </div>
      ) : null}
      {outputLimit && <p className="mb-4 border border-line bg-paper-2 px-4 py-3 text-sm leading-relaxed text-ink" role="status" data-testid="model-output-limit">{outputLimit}</p>}
      <div className="border border-ink bg-paper">
        <div className="px-6 py-6 sm:px-9">
          <div className="max-w-[64ch]">
            {!bibliography && <AnswerEvidenceStatus run={run} />}
            <AnswerMarkdown
              language={generatedProseLanguage}
              text={run.answer}
              citations={run.citations}
              onCitationClick={openCitation}
            />
          </div>

          {run.claimCoverage?.length ? (
            <EvidenceLedger run={run} />
          ) : null}

          <SourceEvidenceLens key={run.id} run={run} />

          {bibliography ? <BibliographyExports result={bibliography} /> : <>
            <EvidenceMatrixExport run={run} />
            <ResearchCitationExport citations={run.citations} />
          </>}

          {run.citations.length > 0 && (
            <div className="@container mt-7 border-t border-ink pt-5">
              <p className="mb-4 font-mono text-[11px] uppercase leading-relaxed tracking-[0.1em] text-ink-3">
                {copy("reportReading.sources")}
              </p>
              <ul aria-label={copy("reportReading.sources")} className="grid gap-3 @2xl:grid-cols-2">
                {run.citations.map((c) => {
                  const articleUrl = safeArticleUrl(c.itemUrl);
                  const isPublicReference = c.sourceKind === "public-reference";
                  return (
                    <li
                      key={c.marker}
                      className={cn(
                        "flex min-w-0 flex-col border border-line bg-paper p-4 transition-colors hover:border-brass focus-within:border-seal [overflow-wrap:anywhere] sm:p-5",
                        highlight === c.marker && "border-seal bg-seal/[0.04]",
                      )}
                    >
                      <div className="mb-4">
                        <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-3">
                          <span className="min-w-0 pt-1 font-display text-lg font-semibold leading-snug text-paid">
                            {c.marker.replace(/\D/g, "") || c.marker}
                          </span>
                          <div className="min-w-0">
                            {articleUrl ? (
                              <a
                                href={articleUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block min-h-11 font-serif text-base leading-relaxed text-ink underline decoration-line underline-offset-4 hover:text-seal hover:decoration-seal focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-seal"
                              >
                                {c.itemTitle ?? c.sourceName}
                              </a>
                            ) : (
                              <span className="block font-serif text-base leading-relaxed text-ink">
                                {c.itemTitle ?? c.sourceName}
                              </span>
                            )}
                            {c.itemTitle ? (
                              <span className="mt-1 block font-mono text-[11px] leading-relaxed text-ink-3">
                                {c.sourceName}
                                {c.itemPublishedAt ? ` · ${c.itemPublishedAt.slice(0, 10)}` : ""}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {(c.evidenceProvenance === "synthetic-demo" || isPublicReference || c.scholarly) && <div className="mt-3 border-l-2 border-line pl-3">
                          {c.evidenceProvenance === "synthetic-demo" && <p className="text-sm leading-relaxed text-seal">{copy("reportReading.synthetic")}</p>}
                          {isPublicReference && (
                            <p className="font-mono text-[11px] leading-relaxed text-ink-3">
                              {c.webProvenance ? copy(c.webProvenance.truncated ? "reportReading.webBounded" : "reportReading.webText", { extraction: c.webProvenance.extraction }) : c.publicDeliveryKind ? c.publicDeliveryKind === "full_text" ? copy("reportReading.rssFullText") : copy("reportReading.rssDelivery", { delivery: c.publicDeliveryKind.replaceAll("_", " ") }) : copy("reportReading.rssFeedBody")}
                            </p>
                          )}
                          {isPublicReference && <PdfReadingScope provenance={c.webProvenance} />}
                          {c.scholarly && <ScholarlyMetadataDetails metadata={c.scholarly} />}
                        </div>}
                      </div>
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                        <button type="button" aria-label={copy("reportReading.inspectCitation", { marker: c.marker })} aria-haspopup="dialog" onClick={(event) => openCitation(c.marker, event.currentTarget)} className="group inline-flex min-h-11 min-w-11 max-w-full items-center justify-center gap-2 border border-line bg-paper-2 px-3 py-2 font-mono text-xs text-seal transition-colors hover:border-seal hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
                          {copy("reportReading.evidence")}<svg aria-hidden="true" className="h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:translate-x-0.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h14m-5-5 5 5-5 5" /></svg>
                        </button>
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span title={copy("reportCitation.title", { source: c.sourceName, weight: Math.round(c.weight * 100) })} className="font-mono text-[11px] tabular-nums text-ink-3">
                            {Math.round(c.weight * 100)}%
                          </span>
                          {!isPublicReference && <span className="font-mono text-xs tabular-nums text-paid">
                            {copy("reportReading.planned", { amount: formatRecordedUsdc(c.reward) })}
                          </span>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {showFeedback ? <><RequesterFeedback key={run.id} runId={run.id} /><AnswerFeedback queryId={run.id} /></> : null}
        <SummaryStrip
          spent={run.totalSpent}
          toCreators={run.totalToCreators}
          bought={bought}
          skipped={skipped}
          reads={reads}
          engine={run.engine}
          pending={run.pendingPayments ?? 0}
          mode={run.paymentMode ?? meta?.mode ?? null}
          historicalNetwork={historicalNetwork}
          permalink={permalink}
        />
      </div>
      {selectedCitation && (
        <CitationEvidencePanel queryId={run.id} citation={selectedCitation} evidence={run.evidence ?? []} payments={payments} onClose={closeCitation} />
      )}
    </div>
  );
}

function safeArticleUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function EvidenceLedger({ run }: { run: QueryRun }) {
  const copy = useUiMessages();
  const evidence = run.evidence ?? [];
  return (
    <div className="mt-7 border-t border-ink pt-5">
      <p className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
        {copy("reportReading.evidenceLedger")}
      </p>
      <p className="mb-3 text-sm text-ink-3">{copy("reportReading.coverageNotice")}</p>
      <ol className="space-y-3">
        {run.claimCoverage?.map((claim) => {
          const spans = evidence.filter(
            (item) =>
              item.claimIndex === claim.claimIndex &&
              (item.qualifiesForAnswer ?? item.qualifiesForReward),
          );
          return (
            <li
              key={`${claim.claimIndex}-${claim.claim}`}
              className="border-l-2 border-line pl-3"
            >
              <div className="flex items-start justify-between gap-4">
                <p className="font-serif text-[14px] leading-snug text-ink">
                  {copy("reportReading.requestedTopic", { claim: claim.claim })}
                </p>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[11px] tabular-nums",
                    claim.coverage >= 0.4 ? "text-paid" : "text-seal",
                  )}
                >
                  {copy("reportReading.estimated", { coverage: Math.round(claim.coverage * 100) })}
                </span>
              </div>
              {spans.length > 0 ? (
                <div className="mt-1.5 space-y-1.5">
                  {spans.map((item, index) => (
                    <blockquote
                      key={`${item.marker}-${index}`}
                      className="whitespace-pre-wrap font-serif text-[13px] italic leading-snug text-ink-2 [overflow-wrap:anywhere]"
                    >
                      “{item.quote}”{" "}
                      <span className="not-italic text-paid">
                        [{item.marker}] {item.itemTitle ?? item.sourceName}
                      </span>
                    </blockquote>
                  ))}
                </div>
              ) : (
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-seal">
                  {copy("reportReading.noExcerpt")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface SummaryStripProps {
  spent: number;
  toCreators: number;
  bought: number;
  skipped: number;
  reads: ReturnType<typeof sourceReadSummary>;
  engine: string;
  pending: number;
  mode: "real" | "offline" | null;
  historicalNetwork?: string;
  permalink?: string;
}

function SummaryStrip({
  spent,
  toCreators,
  bought,
  skipped,
  reads,
  engine,
  pending,
  mode,
  historicalNetwork,
  permalink,
}: SummaryStripProps) {
  const copy = useUiMessages();
  const [copied, setCopied] = useState(false);
  const creatorShare = spent > 0 ? `${Math.round((toCreators / spent) * 100)}%` : "—";
  const readLabels = [
    reads.publicReads ? copy(selectPlural(reads.publicReads) === "one" ? "reportReading.publicRead.one" : "reportReading.publicRead.other", { count: reads.publicReads }) : null,
    reads.cacheHits ? copy(selectPlural(reads.cacheHits) === "one" ? "reportReading.cacheHit.one" : "reportReading.cacheHit.other", { count: reads.cacheHits }) : null,
    reads.failedReads ? copy(selectPlural(reads.failedReads) === "one" ? "reportReading.failedRead.one" : "reportReading.failedRead.other", { count: reads.failedReads }) : null,
    reads.publicSelectionsWithoutOutcome ? copy(selectPlural(reads.publicSelectionsWithoutOutcome) === "one" ? "reportReading.publicSelection.one" : "reportReading.publicSelection.other", { count: reads.publicSelectionsWithoutOutcome }) : null,
    reads.cacheSelectionsWithoutOutcome ? copy(selectPlural(reads.cacheSelectionsWithoutOutcome) === "one" ? "reportReading.cacheSelection.one" : "reportReading.cacheSelection.other", { count: reads.cacheSelectionsWithoutOutcome }) : null,
  ].filter(Boolean);

  const copyPermalink = useCallback(() => {
    if (!permalink) return;
    navigator.clipboard.writeText(permalink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [permalink]);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink bg-paper-2 px-6 py-3.5 text-sm sm:px-9">
      <Stat label={mode === "offline" ? copy("reportReading.simulatedSpend") : mode === "real" ? copy("reportReading.spent") : copy("reportReading.recordedSpend")} value={formatRecordedUsdc(spent)} mono />
      <Stat label={mode === "offline" ? copy("reportReading.simulatedShare") : mode === "real" ? copy("reportReading.toCreators") : copy("reportReading.recordedShare")} value={creatorShare} accent={spent > 0 && mode === "real"} />
      {pending > 0 && <Stat label={copy("reportReading.pendingProof")} value={`${pending}`} />}
      <Stat
        label={copy("reportReading.decisions")}
        value={[copy(selectPlural(bought) === "one" ? "reportReading.bought.one" : "reportReading.bought.other", { count: bought }), copy(selectPlural(skipped) === "one" ? "reportReading.skipped.one" : "reportReading.skipped.other", { count: skipped })].join(" · ")}
      />
      <Stat label={copy("reportReading.reads")} value={readLabels.length ? readLabels.join(" · ") : copy("reportReading.noRecordedReads")} />
      <div className="ml-auto flex items-center gap-2">
        {permalink && (
          <button
            type="button"
            onClick={copyPermalink}
            className="border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink-3 transition-colors hover:border-ink hover:text-ink"
          >
            {copied ? copy("reportReading.copied") : copy("reportReading.share")}
          </button>
        )}
        <span className="border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink-3">
          {engine}
        </span>
        {historicalNetwork ? (
          <span className="border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink-3">
            {copy("reportReading.historical", { network: recordedArcLabel(historicalNetwork) })}
          </span>
        ) : <ModeBadge mode={mode} />}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
        {label}
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums text-ink",
          mono && "font-mono",
          accent && "text-paid",
        )}
      >
        {value}
      </span>
    </div>
  );
}
