"use client";

import { demoteSyntheticEvidence } from "@/lib/research/evidence-provenance";

/**
 * §II · The reading — the grounded answer set as a printed page: Spectral body
 * with footnote citation markers, a footnotes apparatus where each one pays its
 * author, and a settlement strip (spent / % to creators / decisions / engine).
 * When a permalink URL is available, a Share button copies it to the clipboard.
 */

import { useState, useCallback, useRef } from "react";
import type { QueryRun, PaymentRecord } from "@/lib/types";
import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import { AnswerMarkdown } from "./answer-markdown";
import { AnswerFeedback } from "./answer-feedback";
import { ScholarlyMetadataDetails } from "./scholarly-metadata";
import { ModeBadge } from "./mode-badge";
import { SectionHeading } from "./banknote";
import { ConfidenceBadge } from "./confidence-badge";
import { fmtUsdc } from "./phase-style";
import { deriveConfidence } from "@/lib/agent/confidence";
import { cn } from "@/lib/utils";
import { CitationEvidencePanel } from "./citation-evidence-panel";
import { ResearchCitationExport } from "./research-citation-export";
import { EvidenceMatrixExport } from "./evidence-matrix-export";
import { SourceEvidenceLens } from "./source-evidence-lens";
import { reasoningOutputLimitText } from "@/lib/llm/reasoning-telemetry";

export function AnswerCard({ run, meta, permalink, payments = [] }: { run: QueryRun; meta: AskMeta | null; permalink?: string; payments?: PaymentRecord[] }) {
  run = demoteSyntheticEvidence(run);
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
  const cached = run.decisions.filter((d) => d.action === "CACHE").length;
  const confidence = deriveConfidence(run);
  const outputLimit = reasoningOutputLimitText(run.reasoningAttempts, /[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/u.test(run.question) ? "vi" : "en", run.trace);

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500">
      <SectionHeading numeral="II" label="The reading" right={`${run.citations.length} cited`} />
      {confidence ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <ConfidenceBadge confidence={confidence} showReason sourceGrounding={run.citations.some(citation => Boolean(citation.webProvenance))} />
          <span className="border border-line bg-paper-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            {(run.researchMode ?? meta?.researchMode ?? "deep")} research
          </span>
          {run.previewCoverage ? (
            <span className="font-mono text-[10px] text-ink-3">
              preview plan {run.previewCoverage.coveredClaims}/{run.previewCoverage.totalClaims} claims
            </span>
          ) : null}
          {run.evidencePortfolio ? (
            <span
              className="font-mono text-[10px] text-ink-3"
              title="CACHE costs one attention slot but zero fetch USDC; evidence yield counts selected reads that produced reward-qualifying evidence."
            >
              portfolio {run.evidencePortfolio.selectedAssetIds.length}/
              {run.evidencePortfolio.eligibleCandidates}
              {run.evidencePortfolio.outcome?.evidenceYield !== null &&
              run.evidencePortfolio.outcome?.evidenceYield !== undefined
                ? ` · evidence ${Math.round(run.evidencePortfolio.outcome.evidenceYield * 100)}%`
                : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      {outputLimit && <p className="mb-4 border border-line bg-paper-2 px-4 py-3 text-sm leading-relaxed text-ink" role="status" data-testid="model-output-limit">{outputLimit}</p>}
      <div className="border border-ink bg-paper">
        <div className="px-6 py-6 sm:px-9">
          <div className="max-w-[64ch]">
            <AnswerMarkdown
              text={run.answer}
              citations={run.citations}
              onCitationClick={openCitation}
            />
          </div>

          {run.claimCoverage?.length ? (
            <EvidenceLedger run={run} />
          ) : null}

          <SourceEvidenceLens key={run.id} run={run} />

          <EvidenceMatrixExport run={run} />
          <ResearchCitationExport citations={run.citations} />

          {run.citations.length > 0 && (
            <div className="mt-7 border-t border-ink pt-5">
              <p className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                Cited sources and references
              </p>
              <ul>
                {run.citations.map((c) => {
                  const articleUrl = safeArticleUrl(c.itemUrl);
                  const isPublicReference = c.sourceKind === "public-reference";
                  return (
                    <li
                      key={c.marker}
                      className={cn(
                        "flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line py-2.5 transition-colors sm:flex-nowrap",
                        highlight === c.marker && "bg-seal/[0.06]",
                      )}
                    >
                      <span className="w-5 shrink-0 font-display text-[14px] font-semibold text-paid">
                        {c.marker.replace(/\D/g, "") || c.marker}
                      </span>
                      <span className="min-w-[12rem] flex-1">
                        {articleUrl ? (
                          <a
                            href={articleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block break-words font-serif text-[15px] text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                          >
                            {c.itemTitle ?? c.sourceName}
                          </a>
                        ) : (
                          <span className="block break-words font-serif text-[15px] text-ink">
                            {c.itemTitle ?? c.sourceName}
                          </span>
                        )}
                        {c.itemTitle ? (
                          <span className="block break-words font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                            {c.sourceName}
                            {c.itemPublishedAt ? ` · ${c.itemPublishedAt.slice(0, 10)}` : ""}
                          </span>
                        ) : null}
                        {c.evidenceProvenance === "synthetic-demo" && <span className="block text-sm text-seal">Synthetic demo content ? illustrative only</span>}
                        {isPublicReference && (
                          <span className="mt-1 block font-mono text-[10px] text-ink-3">
                            Free public reference · no creator payment
                            {c.webProvenance ? ` · extracted ${c.webProvenance.extraction} text${c.webProvenance.truncated ? " (bounded excerpt)" : ""}` : c.publicDeliveryKind ? ` · RSS ${c.publicDeliveryKind === "full_text" ? "feed full text" : c.publicDeliveryKind.replaceAll("_", " ")}` : " · RSS feed body"}
                          </span>
                        )}
                        {c.scholarly && <ScholarlyMetadataDetails metadata={c.scholarly} />}
                      </span>
                      <button type="button" aria-label={`Inspect evidence for citation ${c.marker}`} aria-haspopup="dialog" onClick={(event) => openCitation(c.marker, event.currentTarget)} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 font-mono text-xs text-seal underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-seal">Evidence</button>
                      <span className="shrink-0 font-mono text-[11px] text-ink-3">
                        {Math.round(c.weight * 100)}%
                      </span>
                      {!isPublicReference && <span className="shrink-0 font-mono text-sm tabular-nums text-paid">
                        ${fmtUsdc(c.reward)} planned
                      </span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <AnswerFeedback queryId={run.id} />
        <SummaryStrip
          spent={run.totalSpent}
          toCreators={run.totalToCreators}
          bought={bought}
          skipped={skipped}
          cached={cached}
          engine={run.engine}
          pending={run.pendingPayments ?? 0}
          mode={run.paymentMode ?? meta?.mode ?? null}
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
  const evidence = run.evidence ?? [];
  return (
    <div className="mt-7 border-t border-ink pt-5">
      <p className="mb-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
        Evidence ledger — recorded source excerpts
      </p>
      <p className="mb-3 text-sm text-ink-3">Research targets are unverified topics. Coverage is an estimate of excerpt support, not proof of entailment, factual truth or a complete answer.</p>
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
                  Requested topic (unverified): “{claim.claim}”
                </p>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[11px] tabular-nums",
                    claim.coverage >= 0.4 ? "text-paid" : "text-seal",
                  )}
                >
                  {Math.round(claim.coverage * 100)}% estimated
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
                  No qualifying excerpt recorded
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
  cached: number;
  engine: string;
  pending: number;
  mode: "real" | "offline" | null;
  permalink?: string;
}

function SummaryStrip({
  spent,
  toCreators,
  bought,
  skipped,
  cached,
  engine,
  pending,
  mode,
  permalink,
}: SummaryStripProps) {
  const [copied, setCopied] = useState(false);
  const creatorShare = spent > 0 ? `${Math.round((toCreators / spent) * 100)}%` : "—";

  const copyPermalink = useCallback(() => {
    if (!permalink) return;
    navigator.clipboard.writeText(permalink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [permalink]);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink bg-paper-2 px-6 py-3.5 text-sm sm:px-9">
      <Stat label={mode === "offline" ? "Simulated spend" : mode === "real" ? "Spent" : "Recorded spend"} value={`$${fmtUsdc(spent)}`} mono />
      <Stat label={mode === "offline" ? "Simulated creator share" : mode === "real" ? "To creators" : "Recorded creator share"} value={creatorShare} accent={spent > 0 && mode === "real"} />
      {pending > 0 && <Stat label="Pending proof" value={`${pending}`} />}
      <Stat
        label="Decisions"
        value={`${bought} bought · ${cached} cached · ${skipped} skipped`}
      />
      <div className="ml-auto flex items-center gap-2">
        {permalink && (
          <button
            type="button"
            onClick={copyPermalink}
            className="border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink-3 transition-colors hover:border-ink hover:text-ink"
          >
            {copied ? "✓ Copied" : "Share"}
          </button>
        )}
        <span className="border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-ink-3">
          {engine}
        </span>
        <ModeBadge mode={mode} />
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
