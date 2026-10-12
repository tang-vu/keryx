import { expect, it } from "vitest";
import { buildDraftCheck, type DraftCheckRequest } from "./draft-check";
import { draftSourcesFromReads, type DraftSourceIdentity } from "./draft-check-sources";
import { parseDraftReferences } from "./draft-check-references";
import { lexicalSupport, prepareDraftSource } from "./draft-check-support";
import { createDraftCheckRoute } from "./draft-check-route";
import { draftCheckTool } from "./draft-check-tool";
import type { GatheredContent } from "../llm/reasoning-engine";

const identity: DraftSourceIdentity = { sourceId: "creator", itemId: "paper", itemUrl: "https://example.org/paper", contentVersion: "v1" };
const input = (): DraftCheckRequest => ({ version: 1, scope: "private-draft-check", passage: "Retrieval improves factual accuracy [1].",
  references: { format: "list", text: identity.itemUrl }, sources: [{ reference: "ref1", coverage: "partial", text: "Retrieval improves factual accuracy.", identity }] });
const read = (changes: Partial<GatheredContent> = {}): GatheredContent => ({ ...identity, sourceName: "Creator", marker: "S1", text: "Retrieval improves factual accuracy.", ...changes });

it("binds exact unchanged claims and verbatim excerpt offsets to each retained source version", () => {
  const request = input(); request.sources[0].text = "Background.\nRetrieval improves factual accuracy.";
  const result = buildDraftCheck(request), citation = result.claims[0].citations[0];
  expect(result.claims[0].text).toBe(request.passage);
  expect(citation.sourceIdentity).toEqual(identity);
  expect(citation.verdict).toBe("supported");
  expect(request.sources[0].text.slice(citation.excerpt!.start, citation.excerpt!.end)).toBe(citation.excerpt!.text);
  request.sources[0].identity = { ...identity, contentVersion: "v2" };
  expect(buildDraftCheck(request).claims[0].citations[0].sourceIdentity?.contentVersion).toBe("v2");
  expect(citation.sourceIdentity?.contentVersion).toBe("v1");
});

it("never borrows matching text from a different exact work", () => {
  const request = input(); request.sources[0].identity = { ...identity, itemUrl: "https://example.org/different" };
  const result = buildDraftCheck(request);
  expect(result.claims[0].citations[0]).toMatchObject({ verdict: "source-unavailable", unavailableReason: "different-work" });
  expect(result.claims[0].citations[0]).not.toHaveProperty("excerpt");
  expect(result.flags).toContainEqual({ kind: "source-different-work", claim: "claim1", reference: "ref1", observedUrl: "https://example.org/different" });
});

it("resolves DOI case/DOI URLs only from matching retained read metadata; no title inference", () => {
  expect(parseDraftReferences("list", "10.5555/ABC\n1. 10.5555/def\n[2]10.5555/ghi").map(row => row.doi)).toEqual(["10.5555/abc", "10.5555/def", "10.5555/ghi"]);
  const request = input(); request.references.text = "10.5555/ABC";
  request.sources[0].identity = { ...identity, doi: "https://doi.org/10.5555/abc" };
  expect(buildDraftCheck(request).claims[0].verdict).toBe("supported");
  request.sources[0].identity = identity;
  expect(buildDraftCheck(request).claims[0].citations[0].unavailableReason).toBe("source-identity-unresolved");
  request.sources[0].identity = { ...identity, itemUrl: "https://example.org/doi.org/10.5555/abc" };
  expect(buildDraftCheck(request).claims[0].citations[0].unavailableReason).toBe("source-identity-unresolved");
  request.sources[0].identity = { ...identity, doi: "https://doi.org.evil.example/10.5555/abc" };
  expect(buildDraftCheck(request).claims[0].citations[0].unavailableReason).toBe("source-identity-unresolved");
  request.sources[0].identity = { ...identity, doi: "10.5555/other" };
  expect(buildDraftCheck(request).claims[0].citations[0].unavailableReason).toBe("different-work");
});

it("keeps no-match partial reads unavailable; only a declared full body permits a text-scoped negative", () => {
  const request = input(); request.sources[0].text = "Glaciers retreated rapidly.";
  expect(buildDraftCheck(request).claims[0].citations[0]).toMatchObject({ verdict: "source-unavailable", unavailableReason: "source-read-incomplete" });
  request.sources[0].coverage = "full-text";
  expect(buildDraftCheck(request).claims[0].citations[0]).toMatchObject({ verdict: "not-found", evidence: "no-supporting-passage-found" });
});

it.each(["partial", "full-text"] as const)("keeps reassigned percentages %s and separate from matching suggestions", coverage => {
  const request = input();
  request.passage = "Women had 60% recovery and men had 40% recovery [1].";
  request.sources[0] = { ...request.sources[0], coverage, text: "Men had 60% recovery and women had 40% recovery." };
  const alternative = { ...identity, itemId: "alternative", itemUrl: "https://example.org/alternative", contentVersion: "v2" };
  request.suggestions = [{ url: alternative.itemUrl, title: "Matching alternative", coverage: "partial",
    text: "Men had 40% recovery and women had 60% recovery.", identity: alternative }];
  const result = buildDraftCheck(request), claim = result.claims[0], citation = claim.citations[0];
  expect(claim).toMatchObject({ start: 0, end: request.passage.length, text: request.passage,
    verdict: coverage === "partial" ? "source-unavailable" : "not-found" });
  expect(citation).toMatchObject({ reference: "ref1", token: "1", coverage, sourceIdentity: identity,
    evidence: coverage === "partial" ? "source-unavailable" : "no-supporting-passage-found" });
  if (coverage === "partial") expect(citation.unavailableReason).toBe("source-read-incomplete");
  else expect(citation.closest).toMatchObject({ difference: "different-number" });
  expect(citation).not.toHaveProperty("excerpt");
  expect(claim.suggestions).toMatchObject([{ kind: "suggestion", verdict: "supported", sourceIdentity: alternative }]);
  expect(result.summary.supported).toBe(0);
});

it.each(["partial", "full-text"] as const)("keeps equal-value many-to-one percentages %s separate from matching suggestions", async coverage => {
  const request = input();
  request.passage = "Women had 60% recovery and men had 60% recovery [1].";
  const body = "Background.\nWomen had 60% recovery unlike men.";
  request.sources = draftSourcesFromReads(parseDraftReferences("list", identity.itemUrl), [read({ text: body })]);
  request.sources[0].coverage = coverage;
  const alternative = { ...identity, itemId: "alternative", itemUrl: "https://example.org/alternative", contentVersion: "v2" };
  const alternativeText = "Men had 60% recovery and women had 60% recovery.";
  request.suggestions = [{ url: alternative.itemUrl, title: "Matching alternative", coverage: "partial", text: alternativeText, identity: alternative }];
  const result = buildDraftCheck(request), claim = result.claims[0], citation = claim.citations[0];
  expect(result).toMatchObject({ version: 1, scope: "private-draft-check", method: "lexical-overlap-v2", summary: { supported: 0, partlySupported: 1 } });
  expect(claim).toMatchObject({ start: 0, end: request.passage.length, text: request.passage, verdict: "partly-supported" });
  expect(citation).toMatchObject({ reference: "ref1", token: "1", coverage, sourceIdentity: identity,
    verdict: "partly-supported", evidence: "verbatim-excerpt", excerpt: { text: "Women had 60% recovery unlike men." } });
  expect(body.slice(citation.excerpt!.start, citation.excerpt!.end)).toBe(citation.excerpt!.text);
  expect(claim.suggestions).toMatchObject([{ kind: "suggestion", verdict: "supported", sourceIdentity: alternative, excerpt: { text: alternativeText } }]);
  expect(alternativeText.slice(claim.suggestions[0].excerpt.start, claim.suggestions[0].excerpt.end)).toBe(claim.suggestions[0].excerpt.text);
  expect(JSON.stringify(result)).not.toContain("Background.");
  const response = await createDraftCheckRoute(async () => null)(new Request("https://example.invalid/api/research/draft-check", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).check).toEqual(result);
  expect(draftCheckTool({ check: request }).structuredContent!.check).toEqual(result);
});

it("binds genuinely matching percentages to the exact completed-read version across API and MCP", async () => {
  const request = input(); request.passage = "Women had 60% recovery and men had 40% recovery [1].";
  const body = "Background.\nMen had 40% recovery and women had 60% recovery.";
  request.sources = draftSourcesFromReads(parseDraftReferences("list", identity.itemUrl), [read({ text: body })]);
  const result = buildDraftCheck(request), citation = result.claims[0].citations[0];
  expect(result.claims[0]).toMatchObject({ text: request.passage, start: 0, end: request.passage.length, verdict: "supported" });
  expect(citation).toMatchObject({ reference: "ref1", sourceIdentity: identity, coverage: "partial", verdict: "supported",
    excerpt: { text: "Men had 40% recovery and women had 60% recovery." } });
  expect(body.slice(citation.excerpt!.start, citation.excerpt!.end)).toBe(citation.excerpt!.text);
  const response = await createDraftCheckRoute(async () => null)(new Request("https://example.invalid/api/research/draft-check", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).check).toEqual(result);
  expect(draftCheckTool({ check: request }).structuredContent!.check).toEqual(result);
});

it("adapts completed read bodies only; excludes missing, oversized, synthetic, ambiguous versions and changed works", () => {
  const references = parseDraftReferences("list", identity.itemUrl);
  expect(draftSourcesFromReads(references, [read()])).toEqual(input().sources);
  for (const reads of [[], [read({ text: "" })], [read({ text: "x".repeat(40_001) })], [read({ evidenceProvenance: "synthetic-demo" })],
    [read({ contentVersion: undefined })], [read({ itemUrl: "not a URL" })], [read(), read({ contentVersion: "v2" })], [read({ itemUrl: "https://example.org/other" })]])
    expect(draftSourcesFromReads(references, reads)).toEqual([]);
});

it("never promotes explicitly synthetic version-bound text or suggestions into support", () => {
  const request = input(); request.sources[0].identity = { ...identity, evidenceProvenance: "synthetic-demo" };
  request.suggestions = [{ url: identity.itemUrl, title: "Demo", coverage: "full-text", text: request.sources[0].text, identity: request.sources[0].identity }];
  const result = buildDraftCheck(request);
  expect(result.claims[0]).toMatchObject({ verdict: "source-unavailable", suggestions: [], citations: [{ unavailableReason: "synthetic-source" }] });
});

it("does not let alternative-source suggestions support unread written citations or change claims", () => {
  const request = input(); request.sources = [];
  request.suggestions = [{ url: identity.itemUrl, title: "Alternative", coverage: "partial", text: "Retrieval improves factual accuracy.", identity }];
  const result = buildDraftCheck(request);
  expect(result.claims[0]).toMatchObject({ text: request.passage, verdict: "source-unavailable", suggestions: [{ kind: "suggestion", excerpt: { text: "Retrieval improves factual accuracy." }, sourceIdentity: identity }] });
  expect(result.claims[0].citations[0]).not.toHaveProperty("excerpt");
  expect(result.summary.supported).toBe(0);
  request.suggestions[0].identity = { ...identity, itemUrl: "https://example.org/changed" };
  expect(() => buildDraftCheck(request)).toThrow("Suggestion identity changed");
});

it("renders the same source-bound packet through API and MCP without widening authentication", async () => {
  const request = input();
  const route = createDraftCheckRoute(async () => null);
  const response = await route(new Request("https://keryx.cc/api/research/draft-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).check).toEqual(draftCheckTool({ check: request }).structuredContent!.check);
});

it.each([
  ["The small model outperformed the large model on translation.", "The large model outperformed the small model on translation."],
  ["Imports exceeded exports in the survey.", "Exports exceeded imports in the survey."],
  ["Predators were more abundant than prey in the reserve.", "Prey were more abundant than predators in the reserve."],
])("withholds a reversed comparison without rewriting either operand: %s", (claim, source) => {
  expect(lexicalSupport(claim, prepareDraftSource(source))).toMatchObject({ verdict: "not-found", closest: { text: source, difference: "reversed-comparison" } });
  expect(lexicalSupport(claim, prepareDraftSource(claim)).verdict).toBe("supported");
});

it("preserves same-direction comparisons and ordinary time/context reordering", () => {
  expect(lexicalSupport("Remote workers reported higher satisfaction than office workers.", prepareDraftSource("Across sectors, remote workers reported higher satisfaction than office workers.")).verdict).toBe("supported");
  expect(lexicalSupport("The treatment group reported lower anxiety scores after eight weeks.", prepareDraftSource("After eight weeks, the treatment group reported lower anxiety scores than controls.")).verdict).toBe("supported");
});
