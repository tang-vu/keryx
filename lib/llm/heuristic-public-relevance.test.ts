import { describe, expect, it } from "vitest";
import { HeuristicEngine } from "./heuristic-engine";
import type { SourceCandidate } from "./reasoning-engine";
import { INTERNAL_RESEARCH_INPUTS } from "../evals/internal-research-inputs";

const question = INTERNAL_RESEARCH_INPUTS.find(input => input.id === "R01")!.question;
const candidate = (change: Partial<SourceCandidate> = {}): SourceCandidate => ({
  id: "backup", sourceKind: "public-reference", name: "SQLite: Online Backup API",
  description: "Metadata only", tags: ["public-web"], preview: "", fetchPrice: 0, cached: false,
  item: { sourceKind: "public-reference", itemId: "backup", itemTitle: "SQLite: Online Backup API",
    itemUrl: "https://example.org/backup", contentVersion: "unread" }, ...change,
});
async function decide(source: SourceCandidate, text = question, claims?: string[]) {
  const engine = new HeuristicEngine();
  return (await engine.decide({ question: text, subClaims: claims ?? await engine.decompose(text),
    candidates: [source], budget: 0, spentSoFar: 0 }))[0];
}

describe("free public title relevance", () => {
  it("investigates a relevant original despite a long multi-part question and zero money", async () => {
    const source = candidate(), before = structuredClone(source);
    const result = await decide(source);
    expect(result).toMatchObject({ action: "BUY", price: 0, targets: [0] });
    expect(result.rationale).toContain("Metadata suggests relevance, not factual support");
    expect(source).toEqual(before);
  });
  it("reuses a relevant cached free original rather than making a purchase", async () => {
    expect(await decide(candidate({ cached: true }))).toMatchObject({ action: "CACHE", price: 0, targets: [0] });
  });
  it.each([
    "Source documentation research overview", "SQLite documentation", "Gardening: roses and tulips",
  ])("does not add a read from generic, one-topic-word or unrelated title %s", async name => {
    expect(await decide(candidate({ name }))).toMatchObject({ action: "SKIP", targets: [] });
  });
  it.each([0.000001, 0.01, 100])("keeps the existing paid decision at price %s", async fetchPrice => {
    expect(await decide(candidate({ fetchPrice }))).toMatchObject({ action: "SKIP", price: fetchPrice, targets: [] });
  });
  it.each([false, true])("keeps creator selection unchanged with cached=%s", async cached => {
    expect(await decide(candidate({ sourceKind: undefined, item: undefined, cached })))
      .toMatchObject({ action: "SKIP", price: 0, targets: [] });
  });
  it.each(["candidate", "item", "external"])("does not infer public-read authority from %s metadata alone", async kind => {
    const source = candidate();
    if (kind === "candidate") delete source.sourceKind;
    if (kind === "item") delete source.item!.sourceKind;
    if (kind === "external") source.external = { resource: "https://example.org/paid", chains: [], payTo: "untrusted", onArc: false };
    expect(await decide(source)).toMatchObject({ action: "SKIP", targets: [] });
  });
  it.each([undefined, "not a URL", "javascript:alert(1)", "ftp://example.org/backup", "https://user:secret@example.org/backup", `https://example.org/${"x".repeat(2048)}`])(
    "does not add a free read for malformed or credential-bearing original %s", async url => {
      const source = candidate();
      if (url === undefined) Reflect.deleteProperty(source.item!, "itemUrl");
      else source.item!.itemUrl = url;
      expect(await decide(source)).toMatchObject({ action: "SKIP", targets: [] });
    },
  );
  it("requires matching topic words in the same target rather than across unrelated targets", async () => {
    const padding = Array.from({ length: 40 }, (_, index) => `constraint${index}`).join(" ");
    const claims = [`Stripe webhook delivery ${padding}`, `PostgreSQL backup recovery ${padding}`];
    expect(await decide(candidate({ name: "Stripe PostgreSQL" }), claims.join("; "), claims))
      .toMatchObject({ action: "SKIP", targets: [] });
  });
  it("keeps the explicit version-bound task on its existing selection policy", async () => {
    expect(await decide(candidate(), `arXiv 2606.02668v1; ${question}`))
      .toMatchObject({ action: "SKIP", targets: [] });
  });
  it("does not inflate an already positive public proposal and crowd out a comparison source", async () => {
    const result = await decide(candidate({ name: "SQLite backup" }),
      "SQLite backup restore durability failures database snapshots checkpoints");
    expect(result).toMatchObject({ action: "BUY", expectedValue: 0.25, confidence: 0.75, targets: [0] });
    expect(result.rationale).toContain("Strong topical match");
  });
  it("retains ordinary strong-match paid BUY and cached reuse proposals", async () => {
    const text = "SQLite backup API", source = candidate({ fetchPrice: 0.01 });
    expect(await decide(source, text)).toMatchObject({ action: "BUY", price: 0.01, targets: [0], expectedValue: 1 });
    expect(await decide({ ...source, cached: true }, text)).toMatchObject({ action: "CACHE", price: 0.01, targets: [0], expectedValue: 1 });
  });
});
