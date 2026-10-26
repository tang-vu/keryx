import { describe, expect, it } from "vitest";
import type { EvidenceRecord, QueryRun } from "../types";
import { zoteroReportReferences } from "./zotero-export";

const citation = { marker: "S1", sourceId: "publisher", sourceName: "Recorded publisher", itemId: "article",
  itemTitle: "Recorded article", itemUrl: "https://publisher.test/article?v=1", contentVersion: "retained-v1",
  weight: 1, reward: 0, rationale: "Synthetic fixture" };
const evidence: EvidenceRecord = { ...citation, claimIndex: 0, claim: "Recorded target?", quote: "Verbatim qualified excerpt.",
  support: .8, qualifiesForAnswer: true, qualifiesForReward: false };
function run(records: EvidenceRecord[] | undefined): QueryRun {
  return { id: "zotero-evidence-fixture", question: "Synthetic local export fixture", answer: "Fixture [S1]", budget: .01,
    citations: [citation], subClaims: [evidence.claim], evidence: records, decisions: [], trace: [], engine: "offline",
    totalSpent: 0, totalToCreators: 0, createdAt: "2026-10-26T00:00:00Z", paymentMode: "offline" };
}
const note = (records: EvidenceRecord[] | undefined) => zoteroReportReferences(run(records), "https://keryx.test")[0].note;

describe("Zotero report excerpt admission", () => {
  it("honors explicit answer rejection even when the old reward flag is true", () => {
    expect(note([{ ...evidence, qualifiesForAnswer: false, qualifiesForReward: true }])).not.toContain("<pre>");
  });

  it.each([
    { quote: " \n\t" },
    { marker: "S9" }, { sourceId: "other" }, { itemId: "other" },
    { itemUrl: "https://publisher.test/article?v=2" }, { contentVersion: "retained-v2" },
  ])("withholds empty or differently cited article/version excerpts: %j", override => {
    expect(note([{ ...evidence, ...override }])).not.toContain("<pre>");
  });

  it("does not send illustrative demo excerpts as factual notes", () => {
    expect(note([{ ...evidence, evidenceProvenance: "synthetic-demo" }])).not.toContain("<pre>");
  });

  it("retains public answer evidence and historical reward-only fallback without changing quote bytes", () => {
    const quote = 'First line.\n  <literal>& "quoted"\n\n';
    const exported = note([{ ...evidence, quote }, { ...evidence, quote, qualifiesForAnswer: undefined, qualifiesForReward: true }]);
    expect(exported).toContain('<pre>First line.\n  &lt;literal&gt;&amp; &quot;quoted&quot;\n\n</pre>');
    expect(exported.match(/<pre>/g)).toHaveLength(1);
  });

  it("keeps metadata references available when a historical evidence ledger is absent", () => {
    const before = run(undefined), original = JSON.stringify(before);
    const references = zoteroReportReferences(before, "https://keryx.test");
    expect(references).toHaveLength(1); expect(references[0].fields.title).toBe(citation.itemTitle);
    expect(references[0].note).not.toContain("<pre>"); expect(JSON.stringify(before)).toBe(original);
  });

  it("retains the existing long native-note boundary instead of truncating to the UI preview", () => {
    const quote = "x".repeat(16_384);
    expect(note([{ ...evidence, quote }])).toContain(`<pre>${quote}</pre>`);
    expect(() => note([{ ...evidence, quote: quote + "x" }])).toThrow("zotero_limit");
  });

  it("retains the typed refusal for malformed historical quote data", () => {
    const malformed = { ...evidence, quote: null } as unknown as EvidenceRecord;
    expect(() => note([malformed])).toThrow("zotero_limit");
    expect(note([{ ...evidence, qualifiesForAnswer: "true" } as unknown as EvidenceRecord])).not.toContain("<pre>");
  });

  it("recovers historical target labels from the ledger without inventing a missing target", () => {
    const historical = run([evidence]); delete (historical as Partial<QueryRun>).subClaims;
    expect(zoteroReportReferences(historical, "https://keryx.test")[0].note).toContain(`<pre>${evidence.quote}</pre>`);
  });
});
