import { expect, it } from "vitest";
import { bibliographyExportsFromCheckedReceipt, exportsFromCheckedReceipt } from "./receipt-exports";
import { readFileSync } from "node:fs";
import { readBibliographicTask } from "./bibliographic-task";
import { recognizeBibliographicTask } from "./bibliographic-task-request";
import { frenchArxivTask } from "./fixtures/bibliographic-task-questions";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchExports } from "./surface-result";
import type { QueryRun, SourceItemIdentity } from "../types";

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
    itemUrl: "https://publisher.example/paper?v=2", contentVersion: "v2", sourceKind: "public-reference" as const, webProvenance };
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
