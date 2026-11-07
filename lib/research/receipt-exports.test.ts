import { expect, it } from "vitest";
import { bibliographyExportsFromCheckedReceipt, exportsFromCheckedReceipt } from "./receipt-exports";
import { readFileSync } from "node:fs";
import { readBibliographicTask } from "./bibliographic-task";
import { recognizeBibliographicTask } from "./bibliographic-task-request";
import { frenchArxivTask } from "./fixtures/bibliographic-task-questions";
import { buildResearchReceipt, researchReceiptDigest, verifyResearchReceipt } from "../research-receipt";
import { researchExports } from "./surface-result";
import type { QueryRun, SourceItemIdentity } from "../types";
import { demoteSyntheticEvidence } from "./evidence-provenance";
import { SEED_EVIDENCE_FINGERPRINTS } from "./seed-evidence-fingerprints";

async function recordedBibliography() {
  const body = readFileSync(new URL("./fixtures/arxiv-2005.11401v4-bibliography.html", import.meta.url), "utf8");
  return readBibliographicTask(recognizeBibliographicTask(frenchArxivTask)!, { reader: async url => ({
    requestedUrl: url, finalUrl: url, observedAt: "2026-10-01T00:00:00Z", mediaType: "text/html", body, truncated: false,
  }) });
}

it("projects validated bibliography separately from cited references without rewriting checked receipt bytes", async () => {
  const bibliography = await recordedBibliography(), receipt = { payload: { bibliography, citations: [] } };
  const before = JSON.stringify(receipt), exports = bibliographyExportsFromCheckedReceipt(receipt)!;
  expect(exports.bibtex).toEqual(bibliography.bibliographyExports.bibtex);
  expect(exports.bibtex.content).toContain("@misc{keryxPaper1,");
  expect(exports.ris.content).toContain("AN  - arXiv:2005.11401v4");
  expect(JSON.parse(exports.cslJson.content)[0]).toMatchObject({ archive_location: "2005.11401v4" });
  expect(exports.cslJson.content).toContain("no Keryx read, citation or settlement evidence");
  expect(exportsFromCheckedReceipt(receipt).cslJson.content).toBe("[]\n");
  expect(JSON.stringify(receipt)).toBe(before);
});

it("refuses absent, corrupt or unbound optional bibliography without reading accessor properties", async () => {
  const bibliography = await recordedBibliography();
  const unbound = structuredClone(bibliography); unbound.record.paper!.title = "Unbound replacement";
  for (const value of [undefined, {}, { payload: {} }, { payload: { bibliography: {} } }, { payload: { bibliography: unbound } }])
    expect(bibliographyExportsFromCheckedReceipt(value)).toBeUndefined();
  let reads = 0;
  const accessor = { get bibliography() { reads++; return bibliography; } };
  expect(bibliographyExportsFromCheckedReceipt({ payload: accessor })).toBeUndefined();
  expect(bibliographyExportsFromCheckedReceipt({ get payload() { reads++; return { bibliography }; } })).toBeUndefined();
  expect(reads).toBe(0);
});

it("exports recorded receipt article identities and answer-qualified public evidence", () => {
  const identity = { marker: "P1", sourceId: "public:paper", sourceName: "Publisher", itemId: "v1",
    itemTitle: "Recorded paper", itemUrl: "https://example.org/paper", contentVersion: "version1", sourceKind: "public-reference" };
  const result = exportsFromCheckedReceipt({ payload: { citations: [{ ...identity, weight: 1, rewardPlannedUsdc: 0, rationale: "read" }],
    claims: [{ claimIndex: 2, claim: "Recorded claim", evidence: [{ ...identity, quote: "Bounded excerpt", support: 0.8,
      qualifiesForAnswer: true, qualifiesForReward: false }, { ...identity, contentVersion: "wrong", quote: "Wrong version", support: 1, qualifiesForReward: true }] }] } });
  expect(result.bibtex.count).toBe(1);
  expect(result.evidenceCsv).toContain("Bounded excerpt");
  expect(result.evidenceCsv).not.toContain("Wrong version");
});

it("leaves old incomplete receipts readable and counts omitted article references", () => {
  const result = exportsFromCheckedReceipt({ payload: { citations: [{ marker: "S1", sourceName: "Creator" }] } });
  expect(result.bibtex).toEqual({ count: 0, omitted: 1, content: "" });
  expect(result.evidenceCsv).not.toContain("Recorded excerpt");
  expect(() => exportsFromCheckedReceipt({ payload: { claims: [{ bad: "optional ledger" }] } })).not.toThrow();
});

const observed = { retrievedAt: "2026-10-24T10:00:00Z", publisherGroup: "publisher.example",
  normalizedBodyHash: "a".repeat(64), extraction: "html" as const, truncated: false };
function scopedRun(webProvenance?: SourceItemIdentity["webProvenance"]): QueryRun {
  const identity = { marker: "S1", sourceId: "public:original", sourceName: "Publisher", itemId: "original",
    itemTitle: "Retained original paper", itemUrl: "https://publisher.example/paper?v=2", contentVersion: "v2", sourceKind: "public-reference" as const, webProvenance };
  return { id: "receipt-scope-fixture", question: "What does the original say?", engine: "offline", budget: 0,
    subClaims: ["Recorded target"], answer: "Exact retained paragraph. [S1]", decisions: [],
    citations: [{ ...identity, weight: 1, reward: 0, rationale: "" }],
    evidence: [{ ...identity, claimIndex: 0, claim: "Recorded target", quote: "Exact retained paragraph.", support: 0.8,
      qualifiesForAnswer: true, qualifiesForReward: false }], totalSpent: 0, totalToCreators: 0,
    trace: [], createdAt: "2026-10-24T10:00:01Z", paymentMode: "offline" };
}

it.each([undefined, observed,
  { ...observed, truncated: true, htmlSectionScope: { format: "keryx-html-section-scope-v1" as const, fragment: "memory-lifetime",
    headingLevel: 2, htmlStart: 1_000, htmlEnd: 2_000, documentCharacters: 5_000, documentSha256: "b".repeat(64) } },
  { ...observed, extraction: "pdf" as const, truncated: true, pdfTextScope: { format: "keryx-pdf-text-scope-v1" as const,
    pagesRead: 3, totalPages: 10, pagesWithoutText: [2], textLimitReached: false } },
])("keeps direct and checked-receipt exports identical with optional recorded scope: %j", provenance => {
  const run = scopedRun(provenance), receipt = buildResearchReceipt(run, []), before = JSON.stringify(receipt);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  const result = exportsFromCheckedReceipt(receipt);
  expect(result).toEqual(researchExports(run));
  expect(result.evidenceCsv).toContain("Exact retained paragraph.");
  if (provenance) {
    expect(result.evidenceCsv).toContain(observed.retrievedAt);
    expect(result.evidenceCsv).toContain(observed.normalizedBodyHash);
  }
  expect(JSON.stringify(receipt)).toBe(before);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
});

it("does not borrow a citation's provenance for an excerpt with unknown scope", () => {
  const run = scopedRun(observed); delete run.evidence![0].webProvenance;
  const receipt = buildResearchReceipt(run, []);
  expect(exportsFromCheckedReceipt(receipt)).toEqual(researchExports(run));
  expect(exportsFromCheckedReceipt(receipt).evidenceCsv).not.toContain(observed.retrievedAt);
});

it("drops unsupported optional metadata without losing the retained excerpt or exposing private fields", () => {
  const receipt = buildResearchReceipt(scopedRun(observed), []);
  const row = receipt.payload.claims[0].evidence[0];
  for (const value of [{ extraction: "pdf" }, { ...observed, extraction: "pdf", pdfTextScope: { pagesRead: 1000 }, privateToken: "PRIVATE_SCOPE_FIELD" }]) {
    Object.assign(row, { webProvenance: value });
    const before = JSON.stringify(receipt), result = exportsFromCheckedReceipt(receipt);
    expect(result.evidenceCsv).toContain("Exact retained paragraph.");
    expect(result.evidenceCsv).not.toContain("PRIVATE_SCOPE_FIELD");
    expect(JSON.stringify(receipt)).toBe(before);
  }
});

it("does not evaluate accessors in optional extraction metadata", () => {
  const receipt = buildResearchReceipt(scopedRun(), []);
  let reads = 0;
  Object.defineProperty(receipt.payload.claims[0].evidence[0], "webProvenance", { get() { reads++; throw Error("No getter"); } });
  expect(exportsFromCheckedReceipt(receipt).evidenceCsv).toContain("Exact retained paragraph.");
  expect(reads).toBe(0);
});

const unsupportedLedgers = [
  { name: "null", value: null }, { name: "object", value: { format: "unsupported-ledger" } },
  { name: "text", value: "unsupported-ledger" }, { name: "number", value: 7 }, { name: "boolean", value: false },
  { name: "over-bound array", value: Array.from({ length: 257 }, (_, claimIndex) => ({ claimIndex,
    claim: "UNSUPPORTED_LEDGER_TARGET", evidence: [] })) },
];

it.each(unsupportedLedgers)("keeps independent citation exports when the checked claims ledger is $name", ({ value }) => {
  const receipt = buildResearchReceipt(scopedRun(observed), []);
  // Construct the controlled legacy/unsupported receipt before its integrity check.
  // Export must never repair or re-seal an original that the caller checked.
  Object.assign(receipt.payload, { claims: value }); receipt.integrity.digest = researchReceiptDigest(receipt.payload);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  const before = JSON.stringify(receipt), expected = exportsFromCheckedReceipt({ payload: { citations: receipt.payload.citations } });
  const result = exportsFromCheckedReceipt(receipt);
  expect(result.bibtex).toEqual(expected.bibtex); expect(result.bibtex.count).toBe(1);
  expect(result.ris).toEqual(expected.ris); expect(result.cslJson).toEqual(expected.cslJson);
  expect(result.evidenceCsv).not.toContain("Exact retained paragraph.");
  expect(result.evidenceCsv).not.toContain("Recorded target"); expect(result.evidenceCsv).not.toContain("UNSUPPORTED_LEDGER_TARGET");
  expect(JSON.stringify(receipt)).toBe(before); expect(verifyResearchReceipt(receipt).valid).toBe(true);
});

it("keeps the supported 256-claim boundary and independently drops a malformed row", () => {
  const receipt = buildResearchReceipt(scopedRun(observed), []), first = receipt.payload.claims[0];
  Object.assign(receipt.payload, { claims: [first, ...Array.from({ length: 254 }, (_, i) => ({ claimIndex: i + 1,
    claim: `Bounded target ${i + 1}`, evidence: [] })), { unsupported: "one bad row" }] });
  receipt.integrity.digest = researchReceiptDigest(receipt.payload);
  const before = JSON.stringify(receipt), result = exportsFromCheckedReceipt(receipt);
  expect(result.bibtex.count).toBe(1); expect(result.evidenceCsv).toContain("Exact retained paragraph.");
  expect(result.evidenceCsv).toContain("Bounded target 254"); expect(result.evidenceCsv).not.toContain("one bad row");
  expect(JSON.stringify(receipt)).toBe(before); expect(verifyResearchReceipt(receipt).valid).toBe(true);
});

it("retains existing refusal for an over-bound citation section", () => {
  const receipt = buildResearchReceipt(scopedRun(observed), []);
  Object.assign(receipt.payload, { citations: Array.from({ length: 65 }, () => receipt.payload.citations[0]) });
  receipt.integrity.digest = researchReceiptDigest(receipt.payload);
  const before = JSON.stringify(receipt), result = exportsFromCheckedReceipt(receipt);
  expect(result.bibtex.count).toBe(0); expect(result.ris.count).toBe(0); expect(result.cslJson.count).toBe(0);
  expect(result.evidenceCsv).not.toContain("Exact retained paragraph."); expect(JSON.stringify(receipt)).toBe(before);
});

type DemoSignal = "citation-label" | "citation-fingerprint" | "evidence-label" | "evidence-fingerprint" | "missing-fingerprint" | "unmarked";
const demoSignals: DemoSignal[] = ["citation-label", "citation-fingerprint", "evidence-label", "evidence-fingerprint", "missing-fingerprint", "unmarked"];

it.each(demoSignals)("keeps recovered and live demo-marker exports equivalent for %s", signal => {
  const seed = SEED_EVIDENCE_FINGERPRINTS.find(row => row.itemTitle === "Measuring x402 settlement latency on Arc")!;
  const seedMetadata = signal.includes("fingerprint");
  const identity = { marker: "S1", sourceId: "archived-source", sourceName: "Archived publisher", itemId: "archived-item", contentVersion: "archived-v1",
    itemTitle: seedMetadata ? seed.itemTitle : "Retained original paper", itemUrl: seedMetadata ? seed.itemUrl : "https://publisher.example/retained",
    sourceKind: "public-reference" as const, webProvenance: observed };
  const body = { bodyHash: seed.bodyHash, deliveryKind: "abstract" as const, storageMode: "db_encrypted" as const, plaintextBytes: 123 };
  const run = scopedRun(observed);
  run.subClaims = ["First retained target", "Second retained target", "Unrelated target"];
  run.citations = [{ ...identity, weight: 1, reward: 0, rationale: "Retained" }, { ...identity, marker: "S2", sourceId: "other-source",
    itemId: "other-item", itemTitle: "Unmarked control", itemUrl: "https://other.example/paper", weight: 0, reward: 0, rationale: "Control" }];
  run.evidence = [0, 1, 2].map(index => ({ ...run.citations[index === 2 ? 1 : 0], claimIndex: index, claim: run.subClaims[index],
    quote: ["First exact retained excerpt.", "Second exact retained excerpt.", "Unrelated exact retained excerpt."][index],
    support: .8, qualifiesForAnswer: true, qualifiesForReward: false }));
  run.claimCoverage = run.subClaims.map((claim, claimIndex) => ({ claim, claimIndex, coverage: .8, coveredBy: [claimIndex === 2 ? "S2" : "S1"] }));
  if (signal === "citation-label") run.citations[0].evidenceProvenance = "synthetic-demo";
  if (signal === "citation-fingerprint") run.citations[0].contentReceipt = body;
  if (signal === "evidence-label") run.evidence[0].evidenceProvenance = "synthetic-demo";
  if (signal === "evidence-fingerprint") run.evidence[0].contentReceipt = body;
  // Construct a controlled old receipt before sealing. The current producer
  // already demotes these markers, so preserve the older per-record shape here.
  const receipt = buildResearchReceipt({ ...run, citations: [], evidence: [] }, []);
  receipt.payload.citations = run.citations.map(({ reward, ...row }) => ({ ...row, rewardPlannedUsdc: reward }));
  receipt.payload.claims = run.subClaims.map((claim, claimIndex) => ({ claim, claimIndex, coverage: .8, coveredBy: [claimIndex === 2 ? "S2" : "S1"],
    evidence: run.evidence!.filter(row => row.claimIndex === claimIndex).map(({ claim: _claim, claimIndex: _index, ...row }) => row) }));
  receipt.integrity.digest = researchReceiptDigest(receipt.payload);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  const originalRun = JSON.stringify(run), originalReceipt = JSON.stringify(receipt);
  const result = exportsFromCheckedReceipt(receipt), expected = researchExports(demoteSyntheticEvidence(run));
  expect(result).toEqual(expected);
  const marked = signal !== "missing-fingerprint" && signal !== "unmarked";
  expect(result.evidenceCsv.match(/Illustrative demo excerpt/g) ?? []).toHaveLength(marked ? 2 : 0);
  expect(result.evidenceCsv.match(/Recorded excerpt/g) ?? []).toHaveLength(marked ? 1 : 3);
  for (const row of run.evidence) expect(result.evidenceCsv).toContain(row.quote);
  expect(result.evidenceCsv).toContain(JSON.stringify(observed.retrievedAt));
  expect(JSON.stringify(run)).toBe(originalRun); expect(JSON.stringify(receipt)).toBe(originalReceipt);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
});
