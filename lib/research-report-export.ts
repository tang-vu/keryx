import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord, QueryRun } from "@/lib/types";
import { recordedAnswerLanguage } from "./research/answer-language-provenance";
import { recordedReportPresentation, presentationReasoningText } from "./research/result-presentation";
import { surfaceReasoning } from "./llm/reasoning-telemetry";
import { reportPresentationMessages } from "./research/report-messages";
import { projectBibliographicTask } from "./research/bibliographic-task-result";
import { createMessages } from "./i18n/messages";

const copy = createMessages("en");

function safeUrl(value?: string): string | null {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Recorded scalar text is data, never Markdown structure or citation controls. */
function reportLiteral(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
    .replace(/\[(S\d+)\]/g, "[\u200b$1]")
    .replace(/[\\`*_{}\[\]()<>#!|]/g, "\\$&");
}
function quotedReportLiteral(value: string): string {
  return `“${reportLiteral(value)}”`;
}

/** Export the observed report; a citation or proposed reward never implies settlement. */
export function researchReportMarkdown(run: QueryRun, meta: AskMeta | null, payments: PaymentRecord[]): string {
  const report = recordedReportPresentation(recordedAnswerLanguage(run)), labels = report.labels;
  const ordinary = reportPresentationMessages(report.locale.language);
  const lines = [labels.title, "", reportLiteral(run.question), "", copy("reportExport.sourceCap", { budget: run.budget, mode: meta?.mode ?? run.paymentMode ?? "unknown" }), ""];
  if (report.notice) lines.push(report.notice, "");
  const reasoning = surfaceReasoning(run.reasoningAttempts, run.trace);
  const limit = reasoning.outputLimits?.length || reasoning.outputLimitTraceStepsOmitted
    ? presentationReasoningText(reasoning, report.locale.language) : "";
  if (limit) lines.push(`> ${limit}`, "");
  lines.push(run.answer, "");
  const bibliography = projectBibliographicTask(run.bibliography);
  if (bibliography) lines.push(labels.bibliography, "", "```bibtex", bibliography.bibliographyExports.bibtex.content, "```", "", "```ris", bibliography.bibliographyExports.ris.content, "```", "");
  lines.push(labels.sources, "");
  for (const citation of run.citations) {
    const url = safeUrl(citation.itemUrl);
    lines.push(`${reportLiteral(citation.marker)}: ${reportLiteral(citation.itemTitle ?? citation.sourceName)}${url ? ` — ${url}` : ""}`);
    if (citation.contentVersion) lines.push(ordinary("documentVersion", { version: reportLiteral(citation.contentVersion) }));
    if (citation.accessKind === "creator-free") lines.push(copy("reportExport.freeAccess"));
    if (citation.sourceClaim) lines.push(copy("reportExport.creatorPolicy", { policy: reportLiteral(JSON.stringify({ id: citation.sourceClaim.id,
      revision: citation.sourceClaim.revision, mode: citation.sourceClaim.mode, effectiveAt: citation.sourceClaim.effectiveAt,
      verifiedAt: citation.sourceClaim.verifiedAt })) }));
    if (citation.webProvenance) lines.push(ordinary("provenance", { provenance: reportLiteral(JSON.stringify(citation.webProvenance)) }));
    if (citation.requestedSource) lines.push(ordinary("scope", { scope: reportLiteral(JSON.stringify(citation.requestedSource)) }));
    if (citation.scholarly) lines.push(ordinary("scholarly", { metadata: reportLiteral(JSON.stringify(citation.scholarly)) }));
  }
  lines.push("", labels.evidence, "");
  lines.push(labels.evidenceNotice, "");
  for (const evidence of run.evidence ?? []) lines.push(ordinary("target", { marker: evidence.marker, claim: quotedReportLiteral(evidence.claim) }), `${labels.quote} ${quotedReportLiteral(evidence.quote)}`, copy("reportExport.admission", { admitted: String(evidence.qualifiesForAnswer === true), eligible: String(evidence.qualifiesForReward) }), "");
  for (const coverage of run.claimCoverage ?? []) lines.push(ordinary("coverage", { claim: quotedReportLiteral(coverage.claim), coverage: coverage.coverage, sources: coverage.coveredBy.length ? reportLiteral(coverage.coveredBy.join(", ")) : ordinary("noSources") }));
  lines.push("", labels.payments, "", copy("reportExport.paymentNotice"));
  if (!payments.length) lines.push(copy("reportExport.noPayments"));
  for (const payment of payments) {
    const recorded = payment.settlementStatus ?? (payment.settled ? "settled" : "unverified");
    const status = payment.settled === (recorded === "settled") ? recorded : "unverified";
    const values = { source: reportLiteral(payment.sourceName), amount: payment.amountUsdc, kind: payment.kind, status };
    lines.push(payment.txHash ? copy("reportExport.paymentReference", { ...values, reference: reportLiteral(payment.txHash) }) : copy("reportExport.payment", values));
  }
  return lines.join("\n");
}

export function researchReportFilename(runId: string): string {
  return `keryx-report-${runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "research"}.md`;
}
