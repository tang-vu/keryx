import { describe, expect, it, vi } from "vitest";
import type { Citation, QueryRun } from "../types";
import { SEED_EVIDENCE_FINGERPRINTS } from "../research/seed-evidence-fingerprints";
import { loadCitedSourceHistory } from "./cited-source-history";

function citation(overrides: Partial<Citation> = {}): Citation {
  return { marker: "S1", sourceId: "public:web:document", sourceName: "Recorded publisher",
    sourceKind: "public-reference", itemTitle: "Original document", itemUrl: "https://docs.example/document#section",
    publicDeliveryKind: "excerpt", weight: 1, reward: 0.1, rationale: "Do not expose allocation rationale",
    webProvenance: { retrievedAt: "2026-10-05T08:00:00.000Z", extraction: "html", truncated: true,
      publisherGroup: "private-group-label", normalizedBodyHash: "private-body-hash" }, ...overrides };
}
function run(overrides: Partial<QueryRun> = {}): QueryRun {
  return { id: "public-run", createdAt: "2026-10-05T09:00:00.000Z", question: "Do not expose question",
    answer: "Recorded answer [S1]", budget: 0.1, engine: "recorded-engine", subClaims: [], decisions: [],
    citations: [citation()], trace: [{ phase: "discover", message: "Do not expose trace", ts: 1 }],
    totalSpent: 0.1, totalToCreators: 0.1, asker: "Do not expose wallet", ...overrides };
}
function database(runs: QueryRun[]) {
  return { listRecentQueries: vi.fn(async () => runs) };
}

describe("bounded public cited-source history", () => {
  it("retains only public citation metadata without bodies, questions, wallets or rewards", async () => {
    const db = database([run()]);
    expect(await loadCitedSourceHistory(db)).toEqual({ runCount: 1, entries: [{
      url: "https://docs.example/document#section", title: "Original document", publisher: "Recorded publisher",
      runId: "public-run", citedAt: "2026-10-05T09:00:00.000Z", deliveryKind: "excerpt", truncated: true,
      retrievedAt: "2026-10-05T08:00:00.000Z", extraction: "html",
    }] });
    expect(db.listRecentQueries).toHaveBeenCalledExactlyOnceWith(50);
    expect(Object.keys((await loadCitedSourceHistory(db)).entries[0]).sort()).toEqual([
      "citedAt", "deliveryKind", "extraction", "publisher", "retrievedAt", "runId", "title", "truncated", "url",
    ]);
  });

  it("deduplicates normalized document URLs while retaining the latest original section URL", async () => {
    const old = run({ id: "older", createdAt: "2026-10-04T00:00:00.000Z", citations: [citation({
      itemUrl: "https://DOCS.example:443/document#old", itemTitle: "Old title", publicDeliveryKind: "full_text",
    })] });
    const recent = run({ id: "latest", citations: [citation(), citation({ itemUrl: "https://docs.example/document#other" })] });
    const result = await loadCitedSourceHistory(database([old, recent, recent]));
    expect(result.runCount).toBe(2);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ runId: "latest", title: "Original document",
      url: "https://docs.example/document#section", deliveryKind: "excerpt" });
  });

  it("excludes private originals, paid listings, synthetic content and uncited answers", async () => {
    const seed = SEED_EVIDENCE_FINGERPRINTS[0];
    const mixed = run({ citations: [
      citation({ sourceKind: undefined }),
      citation({ itemUrl: "https://docs.example/flagged", evidenceProvenance: "synthetic-demo" }),
      citation({ itemTitle: seed.itemTitle, itemUrl: seed.itemUrl, contentReceipt: { bodyHash: seed.bodyHash,
        deliveryKind: "full_text", storageMode: "db_plaintext", plaintextBytes: 100 } }),
    ] });
    const result = await loadCitedSourceHistory(database([
      run({ id: `prv_${"1".repeat(64)}` }), run({ id: "PRV_defensive" }), mixed,
      run({ id: "no-answer", answer: " " }), run({ id: "uncited", citations: [] }),
    ]));
    expect(result).toEqual({ entries: [], runCount: 3 });
  });

  it("rejects credentialed, unsafe, malformed or missing URLs and blank article titles", async () => {
    const rejected = ["javascript:alert(1)", "data:text/plain,body", "https://owner:secret@docs.example/article",
      "http://owner@docs.example/article", "/relative", "https://", " https://docs.example/space", "x".repeat(2049)];
    const result = await loadCitedSourceHistory(database([run({ citations: [
      ...rejected.map(itemUrl => citation({ itemUrl })), citation({ itemUrl: undefined }),
      citation({ itemTitle: " " }), citation({ itemTitle: undefined }),
      citation({ itemUrl: "http://docs.example/http", itemTitle: "Public HTTP original", webProvenance: undefined }),
    ] })]));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ url: "http://docs.example/http", title: "Public HTTP original" });
    expect(result.entries[0]).not.toHaveProperty("retrievedAt");
    expect(result.entries[0]).not.toHaveProperty("truncated");
  });

  it("enforces 50-run, 100-citation-per-run and 40-document bounds", async () => {
    const citations = Array.from({ length: 101 }, (_, index) => citation({ itemUrl: index < 100
      ? "https://docs.example/same" : "https://docs.example/after-citation-cap" }));
    const beyondRunCap = run({ id: "after-run-cap", citations: [citation({ itemUrl: "https://docs.example/after-run-cap" })] });
    const bounded = await loadCitedSourceHistory(database([
      run({ citations }), ...Array.from({ length: 49 }, (_, index) => run({ id: `empty-${index}`, citations: [] })), beyondRunCap,
    ]));
    expect(bounded.runCount).toBe(50);
    expect(bounded.entries.map(entry => entry.url)).toEqual(["https://docs.example/same"]);

    const many = await loadCitedSourceHistory(database([run({ citations: Array.from({ length: 100 }, (_, index) =>
      citation({ itemUrl: `https://docs.example/article-${index}` })) })]));
    expect(many.entries).toHaveLength(40);
    expect(many.entries[39].url).toBe("https://docs.example/article-39");
  });

  it("rejects invalid run identity/dates and never invents missing delivery metadata", async () => {
    const malformed = citation({ publicDeliveryKind: "unknown" as never, sourceName: " ",
      webProvenance: { extraction: "unknown" as never, retrievedAt: "invalid", truncated: "yes" as never,
        publisherGroup: "", normalizedBodyHash: "" } });
    const result = await loadCitedSourceHistory(database([
      run({ id: "" }), run({ id: "invalid-date", createdAt: "invalid" }), run({ citations: [malformed] }),
    ]));
    expect(result).toEqual({ runCount: 1, entries: [{ url: "https://docs.example/document#section", title: "Original document",
      publisher: "Publication not recorded", runId: "public-run", citedAt: "2026-10-05T09:00:00.000Z" }] });
  });

  it("preserves read failures as unavailable rather than returning an empty catalog", async () => {
    await expect(loadCitedSourceHistory({ listRecentQueries: async () => { throw new Error("Read unavailable"); } }))
      .rejects.toThrow("Read unavailable");
    await expect(loadCitedSourceHistory({ listRecentQueries: async () => null as never }))
      .rejects.toThrow("Public source history unavailable");
  });
});
