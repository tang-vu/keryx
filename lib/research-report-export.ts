import type { AskMeta } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord, QueryRun } from "@/lib/types";

function safeUrl(value?: string): string | null {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Export the observed report; a citation or proposed reward never implies settlement. */
export function researchReportMarkdown(run: QueryRun, meta: AskMeta | null, payments: PaymentRecord[]): string {
  const lines = ["# Keryx research report", "", run.question, "", `Source cap: ${run.budget} USDC. Mode: ${meta?.mode ?? run.paymentMode ?? "unknown"}.`, "", run.answer, "", "## Cited sources", ""];
  for (const citation of run.citations) {
    const url = safeUrl(citation.itemUrl);
    lines.push(`${citation.marker}: ${citation.itemTitle ?? citation.sourceName}${url ? ` — ${url}` : ""}`);
    if (citation.contentVersion) lines.push(`Document version: ${citation.contentVersion}`);
    if (citation.webProvenance) lines.push(`Observed provenance: ${JSON.stringify(citation.webProvenance)}`);
  }
  lines.push("", "## Evidence and limitations", "");
  for (const evidence of run.evidence ?? []) lines.push(`${evidence.marker} · ${evidence.claim}`, `Quote: ${evidence.quote}`, `Answer support admitted: ${evidence.qualifiesForAnswer === true}. Reward eligible: ${evidence.qualifiesForReward}.`, "");
  for (const coverage of run.claimCoverage ?? []) lines.push(`${coverage.claim}: ${coverage.coverage} coverage; ${coverage.coveredBy.join(", ") || "no admitted sources"}`);
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
