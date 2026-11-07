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
  it.each([
    "https://publisher.example/paper?ref=![tracking](https://tracker.invalid/pixel)",
    "https://publisher.example/paper?ref=[replacement](https://other.invalid/article)",
    "https://publisher.example/paper?ref=**Trusted**",
    "https://publisher.example/paper?ref=`hidden`",
    "https://publisher.example/paper?ref=&copy;&amp;next=1",
    "https://publisher.example/paper#ref=![tracking](https://tracker.invalid/pixel)",
    "https://publisher.example/paper?a=1&b=2",
    "https://publisher.example/papers/(draft)[1]?q=한글#é",
    "https://publisher.example/paper?x=%5Bencoded%5D&ref=%252F",
  ])("exports the complete source URL as one portable Markdown link: %s", itemUrl => {
    const run = { ...original, confidence: { level: "Low" as const, reason: "Retained assessment." },
      citations: [{ ...original.citations[0], itemUrl }] }, before = JSON.stringify(run);
    const text = researchReportMarkdown(run, null, []), href = new URL(itemUrl).href;
    const links = [...text.matchAll(/<(https?:\/\/[^<>\s]+)>/g)];
    expect(links.map(match => match[1])).toEqual([href]);
    expect(text).toContain(`S1: Article — <${href}>`);
    expect(text).toContain(original.answer); expect(text).toContain("Low — Retained assessment.");
    expect(JSON.stringify(run)).toBe(before);
  });
  it.each(["javascript:alert(1)", "data:text/html,untrusted", "file:///private/report", "ftp://publisher.example/paper",
    "https://user:secret@publisher.example/paper", "https://user@publisher.example/paper", "not a URL", ""])(
    "keeps source URL refusal and recorded citation identity for %s", itemUrl => {
      const run = { ...original, citations: [{ ...original.citations[0], itemUrl }] }, before = JSON.stringify(run);
      const text = researchReportMarkdown(run, null, []);
      expect([...text.matchAll(/<(https?:\/\/[^<>\s]+)>/g)]).toEqual([]);
      expect(text).toContain("S1: Article"); expect(text).toContain("retained-v1");
      expect(text).not.toContain(itemUrl || "not a URL"); expect(text).not.toContain("secret@");
      expect(text).toContain(original.answer); expect(JSON.stringify(run)).toBe(before);
    });
  it("keeps the stored confidence reason literal instead of forging report sections or citations", () => {
    const run = { ...original, confidence: { level: "Low" as const, reason: injection } }, before = JSON.stringify(run);
    const text = researchReportMarkdown(run, null, []);
    noStructureInjection(text); expect(text).toContain("Low"); expect(JSON.stringify(run)).toBe(before);
  });
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
