import { describe, expect, it } from "vitest";
import { HeuristicEngine } from "./heuristic-engine";

describe("free heuristic gap reads", () => {
  it.each([0, -0.000001, 0.01])("recommends relevant free reads at remaining monetary budget %s", async remainingBudget => {
    const result = await new HeuristicEngine().reevaluate({ question: "SQLite WAL reader concurrency",
      subClaims: ["SQLite WAL reader concurrency"], remainingBudget,
      gathered: [{ marker: "S1", sourceId: "intro", sourceName: "Intro", text: "SQLite introduces embedded SQL applications." }],
      skippedSources: [{ id: "free", name: "Documentation", price: 0, preview: "WAL readers continue concurrently with a writer." },
        { id: "paid", name: "Paid documentation", price: 0.02, preview: "WAL readers continue concurrently with a writer." }] });
    expect(result.shouldBuyMore).toBe(true); expect(result.recommendedIds).toEqual(["free"]);
  });
  it("refuses additional paid-only candidates at exhausted budget", async () => {
    const result = await new HeuristicEngine().reevaluate({ question: "WAL concurrency", subClaims: ["WAL concurrency"], remainingBudget: 0,
      gathered: [{ marker: "S1", sourceId: "intro", sourceName: "Intro", text: "Embedded SQL." }],
      skippedSources: [{ id: "paid", name: "WAL", price: 0.001, preview: "Concurrency details" }] });
    expect(result.shouldBuyMore).toBe(false); expect(result.recommendedIds).toEqual([]);
  });
});


it("retains independent scope targets and refuses excess requested scope instead of discarding it", async () => {
  const engine = new HeuristicEngine();
  const targets = ["paper one methods", "paper one evaluation", "paper one limitations", "paper two methods", "paper two evaluation", "paper two limitations"];
  expect(await engine.decompose(targets.join("; "))).toHaveLength(6);
  await expect(engine.decompose(Array.from({ length: 9 }, (_, index) => `scope target ${index}`).join("; "))).rejects.toThrow("exceeds 8");
});
