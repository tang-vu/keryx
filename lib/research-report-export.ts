import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord, QueryRun } from "@/lib/types";

function safeUrl(value?: string): string | null {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Recorded topics/excerpts are quoted data, never Markdown structure or citation controls. */
function quotedReportLiteral(value: string): string {
  const literal = value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
    .replace(/\[(S\d+)\]/g, "[\u200b$1]")
    .replace(/[\\`*_{}\[\]()<>#!|]/g, "\\$&");
  return `“${literal}”`;
}

/** Export the observed report; a citation or proposed reward never implies settlement. */
export function researchReportMarkdown(run: QueryRun, meta: AskMeta | null, payments: PaymentRecord[]): string {
  const lines = ["# Keryx research report", "", run.question, "", `Source cap: ${run.budget} USDC. Mode: ${meta?.mode ?? run.paymentMode ?? "unknown"}.`, "", run.answer, "", "## Cited sources", ""];
  for (const citation of run.citations) {
    const url = safeUrl(citation.itemUrl);
    lines.push(`${citation.marker}: ${citation.itemTitle ?? citation.sourceName}${url ? ` — ${url}` : ""}`);
    if (citation.contentVersion) lines.push(`Document version: ${citation.contentVersion}`);
    if (citation.accessKind === "creator-free") lines.push("Access: creator-authorized free read; no access-settlement receipt.");
    if (citation.sourceClaim) lines.push(`Captured creator policy: ${JSON.stringify({ id: citation.sourceClaim.id,
      revision: citation.sourceClaim.revision, mode: citation.sourceClaim.mode, effectiveAt: citation.sourceClaim.effectiveAt,
      verifiedAt: citation.sourceClaim.verifiedAt })}. This is historical context, not current payout authority.`);
    if (citation.webProvenance) lines.push(`Observed provenance: ${JSON.stringify(citation.webProvenance)}`);
    if (citation.requestedSource) lines.push(`Supplied original scope: ${JSON.stringify(citation.requestedSource)}`);
    if (citation.scholarly) lines.push(`Observed scholarly metadata and read scope (peer review unknown): ${JSON.stringify(citation.scholarly)}`);
  }
  lines.push("", "## Evidence and limitations", "");
  lines.push("Research targets are unverified topics. Recorded excerpt support and coverage are estimates, not proof of entailment, factual truth or complete synthesis.", "");
  for (const evidence of run.evidence ?? []) lines.push(`${evidence.marker} · Research target (unverified): ${quotedReportLiteral(evidence.claim)}`, `Quote: ${quotedReportLiteral(evidence.quote)}`, `Source excerpt admitted: ${evidence.qualifiesForAnswer === true}. Reward eligible: ${evidence.qualifiesForReward}.`, "");
  for (const coverage of run.claimCoverage ?? []) lines.push(`Research target (unverified): ${quotedReportLiteral(coverage.claim)}: ${coverage.coverage} recorded coverage estimate; ${coverage.coveredBy.join(", ") || "no admitted sources"}`);
  lines.push("", "## Creator payment evidence", "", "A citation alone does not prove settlement. Search and model operating costs are separate from the source cap.");
  if (!payments.length) lines.push("No payment records received in this conversation.");
  for (const payment of payments) {
    const recorded = payment.settlementStatus ?? (payment.settled ? "settled" : "unverified");
    const status = payment.settled === (recorded === "settled") ? recorded : "unverified";
    lines.push(`${payment.sourceName}: ${payment.amountUsdc} USDC · ${payment.kind} · ${status}${payment.txHash ? ` · reference ${payment.txHash}` : ""}`);
  }
  return lines.join("\n");
}

export function researchReportFilename(runId: string): string {
  return `keryx-report-${runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "research"}.md`;
}
