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
