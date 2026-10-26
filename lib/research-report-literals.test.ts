import { describe, expect, it } from "vitest";
import { researchReportMarkdown } from "./research-report-export";
import type { PaymentRecord, QueryRun } from "./types";

const injection = 'Original text\n\n## FAKE SETTLEMENT\n**Paid** [S99]\u2028<script>literal</script>\u0000';
const original: QueryRun = { id: "literal-report", question: "Question", answer: "## Authored answer\n\nRetained result [S1].",
  citations: [{ marker: "S1", sourceId: "publisher", sourceName: "Publisher", itemTitle: "Article", itemUrl: "https://publisher.test/article", contentVersion: "retained-v1", weight: 1, reward: 0, rationale: "Fixture" }],
  subClaims: [], evidence: [], decisions: [], trace: [], engine: "offline", paymentMode: "offline", budget: .01,
  totalSpent: 0, totalToCreators: 0, createdAt: "2026-10-26T00:00:00Z" };
function noStructureInjection(text: string) {
  expect(text).not.toContain("\n## FAKE SETTLEMENT"); expect(text).not.toContain("**Paid**");
  expect(text).not.toContain("[S99]"); expect(text).not.toContain("<script>"); expect(text).not.toContain("\u0000");
  expect(text).toContain("Original text"); expect(text).toContain(original.answer);
}

describe("literal report metadata", () => {
  it("keeps a requested question as data while retaining authored answer Markdown", () => {
    const run = { ...original, question: injection }, before = JSON.stringify(run);
    noStructureInjection(researchReportMarkdown(run, null, [])); expect(JSON.stringify(run)).toBe(before);
  });
  it.each(["marker", "itemTitle", "sourceName", "contentVersion"] as const)("neutralizes citation %s markup without mutating the report", field => {
    const run = { ...original, citations: [{ ...original.citations[0], [field]: injection,
      ...(field === "sourceName" ? { itemTitle: undefined } : {}) }] }, before = JSON.stringify(run);
    noStructureInjection(researchReportMarkdown(run, null, [])); expect(JSON.stringify(run)).toBe(before);
  });
  it("keeps provider metadata JSON as literal recorded context", () => {
    const run = { ...original, citations: [{ ...original.citations[0], webProvenance: { url: injection } }] } as unknown as QueryRun;
    noStructureInjection(researchReportMarkdown(run, null, []));
  });
  it.each(["sourceName", "txHash"] as const)("keeps payment %s labels from forging an additional settlement section", field => {
    const payment: PaymentRecord = { queryId: original.id, sourceId: "publisher", sourceName: "Writer",
      payer: "synthetic-payer", payee: "synthetic-payee", amountUsdc: .001, kind: "citation", network: "offline",
      settled: false, settlementStatus: "pending", createdAt: original.createdAt, [field]: injection };
    const text = researchReportMarkdown(original, null, [payment]); noStructureInjection(text);
    expect(text).toContain("· pending"); expect(text).not.toContain("· settled");
  });
});
