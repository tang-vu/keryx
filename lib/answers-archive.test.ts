import { describe, it, expect } from "vitest";
import { buildArchive, normalizeQuestion, cleanText } from "./answers-archive";
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
