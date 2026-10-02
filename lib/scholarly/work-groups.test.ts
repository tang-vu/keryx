import { expect, it } from "vitest";
import type { GatheredContent } from "../llm";
import { scholarlyWorkGroups } from "./work-groups";
import { researchVerdict } from "../agent/research-verdict";

function source(marker: string, host: string, doi?: string): GatheredContent {
  return { marker, sourceId: "public:scholarly:" + marker, sourceName: host, sourceKind: "public-reference", itemUrl: `https://${host}/article`, text: `Distinct observed document text ${marker}.`,
    scholarly: { provider: host === "arxiv.org" ? "arxiv" : "crossref", title: "Work", recordUrl: "https://api.crossref.org/works/record", retrievedAt: "2026-10-01T00:00:00Z", authors: [],
      doi, workType: "other", peerReview: "unknown", evidenceScope: "paper-text" } };
}
function verdict(sources: GatheredContent[]) {
  return researchVerdict({ sources, citedMarkers: sources.map(source => source.marker), sourceMarkers: sources.map(source => source.marker), conflicts: [], finalAssessmentSufficient: true,
    coverage: [{ claimIndex: 0, claim: "A supported claim", coverage: 0.9, coveredBy: sources.map(source => source.marker) }] });
}
it("cannot count one DOI's repository and publisher versions as two corroborating domain groups", () => {
  const sources = [source("S1", "arxiv.org", "10.1234/shared"), source("S2", "journal.example", "10.1234/SHARED")];
  expect(new Set(scholarlyWorkGroups(sources, new Set(["S1", "S2"])).values()).size).toBe(1);
  expect(verdict(sources).level).toBe("Moderate");
  expect(sources.map(source => source.itemUrl)).toEqual(["https://arxiv.org/article", "https://journal.example/article"]);
});
it("retains distinct publisher/observed-work diversity and never increases existing same-domain diversity", () => {
  const different = [source("S1", "journal-one.example", "10.1234/one"), source("S2", "journal-two.example", "10.1234/two")];
  expect(verdict(different).level).toBe("High");
  expect(verdict([source("S1", "arxiv.org", "10.1234/one"), source("S2", "arxiv.org", "10.1234/two")]).level).toBe("Moderate");
});
it("is order invariant and conservatively merges transitive publisher/DOI relationships", () => {
  const sources = [source("S1", "arxiv.org", "10.1234/one"), source("S2", "journal-one.example", "10.1234/one"),
    source("S3", "journal-one.example", "10.1234/two"), source("S4", "journal-two.example", "10.1234/two")];
  const cited = new Set(sources.map(source => source.marker));
  expect(Object.fromEntries(scholarlyWorkGroups(sources, cited))).toEqual(Object.fromEntries(scholarlyWorkGroups([...sources].reverse(), cited)));
  expect(new Set(scholarlyWorkGroups(sources, cited).values()).size).toBe(1);
});
it("ignores uncited records, unread metadata, absent DOI and malformed identity without guessing links", () => {
  const sources = [source("S1", "arxiv.org"), source("S2", "journal.example", "not-a-doi"), source("S3", "third.example", "10.1234/same")];
  sources[0].scholarly = { ...sources[0].scholarly!, doi: "10.1234/same", evidenceScope: undefined };
  expect(new Set(scholarlyWorkGroups(sources, new Set(["S1", "S2"])).values()).size).toBe(2);
  expect(scholarlyWorkGroups(sources, new Set(["S1", "S2"])).has("S3")).toBe(false);
});
