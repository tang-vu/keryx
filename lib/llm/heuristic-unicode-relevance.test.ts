import { expect, it } from "vitest";
import { HeuristicEngine } from "./heuristic-engine";
import { isCompleteEvidenceSpan } from "./evidence-span";
import type { GatheredContent, SourceCandidate } from "./reasoning-engine";
import { executeResearchWorkload, workloadSnapshotHash, type WorkloadRead } from "../evals/research-workload";
import type { InternalResearchInput } from "../evals/internal-research-input-types";

const engine = new HeuristicEngine();
// Synthetic text, not factual, customer, provider or settlement observations.
const words = [
  { language: "Vietnamese", query: "khí hậu", body: "Khí hậu là chủ đề được ghi trong tài liệu minh họa này." },
  { language: "French", query: "résumé", body: "Le résumé présente les notes du document fictif." },
  { language: "Spanish", query: "niñez", body: "La niñez aparece como título del documento ficticio." },
];
const forms = ["NFC", "NFD"] as const;
const variants = words.flatMap(row => forms.flatMap(queryForm => forms.map(sourceForm => ({
  ...row, queryForm, sourceForm, query: row.query.normalize(queryForm), body: row.body.normalize(sourceForm),
}))));
const gathered = (id: string, text: string): GatheredContent => ({ marker: id, sourceId: id, sourceName: id, text, itemUrl: `https://example.org/${id}` });
const candidate = (id: string, name: string, text: string, price = 0): SourceCandidate => ({ id, name, description: text, preview: text, tags: [], fetchPrice: price, cached: false });

it.each(variants)("keeps $language words through selection, coverage, exact synthesis and attribution ($queryForm/$sourceForm)", async row => {
  const first = gathered("good", `🧪 Ignore this unrelated sentence. ${row.body}`);
  const other = gathered("noise", "The sum is the total obtained by adding numbers.");
  const sources = [first, other], before = JSON.stringify(sources);
  const proposals = await engine.decide({ question: row.query, subClaims: [row.query], candidates: [candidate("good", row.query, row.body)], budget: 0, spentSoFar: 0 });
  expect(proposals[0]).toMatchObject({ sourceId: "good", action: "BUY", expectedValue: 1, price: 0, targets: [0] });
  const coverage = await engine.sufficiency({ question: row.query, subClaims: [row.query], gathered: sources });
  expect(coverage.sufficient).toBe(true);
  expect(coverage.perClaim).toEqual([{ claim: row.query, coverage: 1, coveredBy: ["good"] }]);
  const review = await engine.reevaluate({ question: row.query, subClaims: [row.query], gathered: sources,
    skippedSources: [{ id: "unnecessary", name: row.query, preview: row.body, price: 0.01 }], remainingBudget: 0.01 });
  expect(review.claims[0]).toMatchObject({ coverage: 1, coveredBy: ["good"] });
  expect(review.shouldBuyMore).toBe(false); expect(review.recommendedIds).toEqual([]);
  const result = await engine.synthesize({ question: row.query, subClaims: [row.query], gathered: sources });
  expect(result.evidence).toHaveLength(1);
  expect(result.evidence![0]).toMatchObject({ marker: "good", quote: row.body, support: 1 });
  expect(result.citedMarkers).toEqual(["good"]);
  const evidence = result.evidence![0];
  expect(isCompleteEvidenceSpan(first, evidence.quote, evidence.quoteSpan)).toBe(true);
  expect(evidence.quoteSpan!.start).toBe(first.text.indexOf(row.body));
  expect(first.text.slice(evidence.quoteSpan!.start, evidence.quoteSpan!.end)).toBe(row.body);
  const weights = await engine.attribute({ question: row.query, answer: row.query, used: sources });
  expect(weights[0].weight).toBeGreaterThan(0.9); expect(weights[1].weight).toBeLessThan(0.1);
  expect(weights.reduce((total, item) => total + item.weight, 0)).toBeCloseTo(1, 3);
  expect(JSON.stringify(sources)).toBe(before);
});

it.each([
  { query: "résumé", fragment: "sum" }, { query: "mañana", fragment: "ana" },
  { query: "garçon", fragment: "gar" }, { query: "Straße", fragment: "stra" },
])("does not treat an ASCII fragment $fragment as the whole accented word $query", async ({ query, fragment }) => {
  const text = `The ${fragment} marker appears in this unrelated synthetic document.`;
  const source = gathered("unrelated", text);
  const proposals = await engine.decide({ question: query, subClaims: [query], candidates: [candidate("unrelated", fragment, text, 0.001)], budget: 0.01, spentSoFar: 0 });
  expect(proposals[0]).toMatchObject({ action: "SKIP", expectedValue: 0, targets: [] });
  const coverage = await engine.sufficiency({ question: query, subClaims: [query], gathered: [source] });
  expect(coverage.perClaim?.[0]).toMatchObject({ coverage: 0, coveredBy: [] });
  const review = await engine.reevaluate({ question: query, subClaims: [query], gathered: [],
    skippedSources: [{ id: "unrelated", name: fragment, preview: text, price: 0.001 }], remainingBudget: 0.01 });
  expect(review.recommendedIds).toEqual([]);
  const result = await engine.synthesize({ question: query, subClaims: [query], gathered: [source] });
  expect(result.evidence).toEqual([]);
  // Legacy fallback prose is separate from evidence; it gains no support here.
});

it.each(["climate weather", "archive retention", "alpha-beta", "version 123", "HTTP cache"])(
  "keeps ordinary ASCII selection and extractive evidence for %s", async query => {
    const text = `The ${query} fixture appears in this complete synthetic sentence.`;
    const source = gathered("ascii", text);
    const proposals = await engine.decide({ question: query, subClaims: [query], candidates: [{ ...candidate("ascii", query, text), cached: true }], budget: 0, spentSoFar: 0 });
    expect(proposals[0]).toMatchObject({ action: "CACHE", expectedValue: 1, price: 0 });
    const result = await engine.synthesize({ question: query, subClaims: [query], gathered: [source] });
    expect(result.evidence).toEqual([{ claimIndex: 0, marker: "ascii", quote: text, quoteSpan: { start: 0, end: text.length }, support: 1 }]);
  });

it.each(["the and of", "AI ML", "á é í"])("keeps stop words and the existing short-term threshold for %s", async query => {
  const text = `The ${query} tokens appear in a synthetic example.`;
  const result = await engine.decide({ question: query, subClaims: [query], candidates: [candidate("short", query, text)], budget: 0, spentSoFar: 0 });
  expect(result[0]).toMatchObject({ action: "SKIP", expectedValue: 0 });
});

it.each([0, 0.001, 0.002])("keeps the existing remaining-budget and two-source re-evaluation bounds at %s", async remainingBudget => {
  const query = "khí hậu", text = words[0].body;
  const result = await engine.reevaluate({ question: query, subClaims: [query], gathered: [], remainingBudget,
    skippedSources: [{ id: "free", name: query, preview: text, price: 0 }, { id: "paid", name: query, preview: text, price: 0.001 }, { id: "too-much", name: query, preview: text, price: 0.1 }] });
  expect(result.recommendedIds).toEqual(remainingBudget === 0 ? ["free"] : ["free", "paid"]);
  expect(result.recommendedIds.length).toBeLessThanOrEqual(2);
  expect(result.recommendedIds).not.toContain("too-much");
});

async function workload(query: string, body: string, failed: boolean) {
  const url = "https://example.org/accented-original";
  const input: InternalResearchInput = { id: "R99", inputKind: "synthetic", question: query, targets: [query],
    sources: [{ title: query, url }], expectedArtifact: "Exact admitted original excerpt or an explicit gap; no real payment or provider", review: [] };
  const article = { title: query, finalUrl: url, kind: "text" as const, truncated: false, text: body };
  const read: WorkloadRead = { url, title: query, observedAt: "2026-10-01T00:00:00Z", provenance: "synthetic",
    ...(failed ? { failure: "transport-unavailable" as const } : { article, snapshotSha256: workloadSnapshotHash(article) }) };
  const before = JSON.stringify(read);
  const result = await executeResearchWorkload(input, [read], new HeuristicEngine());
  expect(result.observation.readAttempts).toEqual([url]);
  expect(result.observation.hardFailures).toEqual([]); expect(result.observation.paymentAttempts).toBe(0); expect(result.observation.paymentRows).toBe(0);
  expect(result.run.totalSpent).toBe(0); expect(result.run.totalToCreators).toBe(0);
  expect(JSON.stringify(read)).toBe(before);
  return { result, url };
}

it.each(forms.flatMap(queryForm => forms.flatMap(sourceForm => [false, true].map(failed => ({ queryForm, sourceForm, failed })))))(
  "ordinary research retains the original Vietnamese excerpt only after a successful read ($queryForm/$sourceForm failed=$failed)", async ({ queryForm, sourceForm, failed }) => {
  const body = words[0].body.normalize(sourceForm);
  const { result, url } = await workload(words[0].query.normalize(queryForm), body, failed);
  const admitted = result.run.evidence?.filter(row => row.qualifiesForAnswer) ?? [];
  expect(result.run.citations).toHaveLength(failed ? 0 : 1);
  expect(admitted).toHaveLength(failed ? 0 : 1);
  if (!failed) {
    expect(admitted[0]).toMatchObject({ itemUrl: url, quote: body, qualifiesForReward: false });
    expect(result.run.answer).toContain(body);
    expect(result.exports.bibtex.content).toContain(url);
  }
  expect(result.run.confidence?.level).toBe("Low");
});

it("a relevant accented title cannot qualify a body containing only the former ASCII fragment", async () => {
  const { result } = await workload("résumé", "The sum is the total obtained by adding numbers.", false);
  expect(result.run.citations).toEqual([]);
  expect(result.run.evidence?.some(row => row.qualifiesForAnswer || row.qualifiesForReward)).toBe(false);
  expect(result.run.confidence?.level).toBe("Low");
});
