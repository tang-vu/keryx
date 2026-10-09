import { expect, it } from "vitest";
import { bibliographyExportsFromCheckedReceipt, exportsFromCheckedReceipt } from "./receipt-exports";
import { readFileSync } from "node:fs";
import { readBibliographicTask } from "./bibliographic-task";
import { recognizeBibliographicTask } from "./bibliographic-task-request";
import { frenchArxivTask } from "./fixtures/bibliographic-task-questions";

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
