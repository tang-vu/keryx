import { describe, it, expect } from "vitest";
import {
  buildArchive,
  normalizeQuestion,
  cleanText,
  relatedAnswers,
  type ArchiveEntry,
} from "./answers-archive";
import type { QueryRun } from "./types";

function run(over: Partial<QueryRun>): QueryRun {
  return {
    id: "r1",
    question: "What is x402?",
    budget: 0.05,
    engine: "llm:claude",
    subClaims: [],
    decisions: [],
    citations: [{ marker: "S1", sourceId: "s1", sourceName: "Latent Space", weight: 1, reward: 0.001, rationale: "" }],
    answer: "x402 is an HTTP payment scheme [S1].",
    totalSpent: 0.01,
    totalToCreators: 0.005,
    trace: [],
    createdAt: "2026-07-10T00:00:00.000Z",
    ...over,
  };
}

describe("normalizeQuestion", () => {
  it("lowercases, collapses whitespace, strips trailing punctuation", () => {
    expect(normalizeQuestion("  What  is  x402? ")).toBe("what is x402");
    expect(normalizeQuestion("What is x402")).toBe("what is x402");
  });
});

describe("cleanText", () => {
  it("removes citation markers and markdown", () => {
    expect(cleanText("It is **bold** and cited [S1] `code`.")).toBe("It is bold and cited code.");
  });
});

describe("buildArchive", () => {
  it("drops runs with no answer or no citations", () => {
    const runs = [
      run({ id: "ok" }),
      run({ id: "no-answer", question: "Q2", answer: "  " }),
      run({ id: "no-cite", question: "Q3", citations: [] }),
    ];
    const out = buildArchive(runs);
    expect(out.map((e) => e.id)).toEqual(["ok"]);
  });

  it("dedupes by normalized question, keeping the most-cited then most-paid run", () => {
    const runs = [
      run({ id: "thin", question: "What is x402?", createdAt: "2026-07-12T00:00:00.000Z" }),
      run({
        id: "rich",
        question: "what is x402",
        createdAt: "2026-07-11T00:00:00.000Z",
        citations: [
          { marker: "S1", sourceId: "s1", sourceName: "A", weight: 0.5, reward: 0.001, rationale: "" },
          { marker: "S2", sourceId: "s2", sourceName: "B", weight: 0.5, reward: 0.001, rationale: "" },
        ],
      }),
    ];
    const out = buildArchive(runs);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("rich"); // 2 citations beats 1, even though "thin" is newer
    expect(out[0].citationCount).toBe(2);
  });

  it("sorts distinct questions newest first and truncates long answers", () => {
    const long = "word ".repeat(100);
    const runs = [
      run({ id: "old", question: "Older?", createdAt: "2026-07-01T00:00:00.000Z" }),
      run({ id: "new", question: "Newer?", createdAt: "2026-07-13T00:00:00.000Z", answer: long }),
    ];
    const out = buildArchive(runs);
    expect(out.map((e) => e.id)).toEqual(["new", "old"]);
    expect(out[0].answerSnippet.endsWith("…")).toBe(true);
    expect(out[0].answerSnippet.length).toBeLessThan(long.length);
  });
});

describe("relatedAnswers", () => {
  function entry(over: Partial<ArchiveEntry>): ArchiveEntry {
    return {
      id: "e1",
      question: "What is x402?",
      answerSnippet: "",
      citationCount: 1,
      toCreators: 0.001,
      totalSpent: 0.01,
      sourceNames: ["Latent Space"],
      createdAt: "2026-07-10T00:00:00.000Z",
      ...over,
    };
  }
  const current = { id: "cur", question: "How does x402 settle payments?", sourceNames: ["Latent Space"] };

  it("ranks shared cited sources above keyword overlap", () => {
    const archive = [
      entry({ id: "kw", question: "Where do payments flow on Arc?", sourceNames: ["Other Blog"] }),
      entry({ id: "src", question: "Who runs the Gateway contract?", sourceNames: ["Latent Space"] }),
    ];
    const out = relatedAnswers(current, archive, 2);
    expect(out[0].id).toBe("src"); // 1 shared source (×2) beats keyword hits
  });

  it("excludes the current dispatch and any entry for the same question", () => {
    const archive = [
      entry({ id: "cur" }),
      entry({ id: "same-q", question: "how does x402 settle payments" }),
      entry({ id: "other", question: "What is the x402 batching SDK?" }),
    ];
    const out = relatedAnswers(current, archive, 4);
    expect(out.map((e) => e.id)).toEqual(["other"]);
  });

  it("fills with newest entries when nothing overlaps, so no page dead-ends", () => {
    const archive = [
      entry({ id: "a", question: "Elephants in Kenya?", sourceNames: ["Safari"], createdAt: "2026-07-12T00:00:00.000Z" }),
      entry({ id: "b", question: "Bread baking basics?", sourceNames: ["Oven"], createdAt: "2026-07-11T00:00:00.000Z" }),
      entry({ id: "c", question: "Cloud formations?", sourceNames: ["Sky"], createdAt: "2026-07-10T00:00:00.000Z" }),
    ];
    const out = relatedAnswers(current, archive, 2);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]); // newest-first fill
  });

  it("puts scored matches ahead of the fill and respects the limit", () => {
    const archive = [
      entry({ id: "new-noise", question: "Bread baking basics?", sourceNames: ["Oven"], createdAt: "2026-07-13T00:00:00.000Z" }),
      entry({ id: "match", question: "Why did x402 choose HTTP 402?", sourceNames: ["Latent Space"], createdAt: "2026-07-01T00:00:00.000Z" }),
    ];
    const out = relatedAnswers(current, archive, 2);
    expect(out.map((e) => e.id)).toEqual(["match", "new-noise"]);
    expect(relatedAnswers(current, archive, 1).map((e) => e.id)).toEqual(["match"]);
  });
});
