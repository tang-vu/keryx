/**
 * Cross-query learning. What must never break: a source is judged only against past runs about the
 * same subject (scored against everything, a specialist reads as a dud and a generalist as a star),
 * the denominator is runs that actually *read* it (so a skip can never justify the next skip), and
 * a sample too thin or too far off-subject produces no claim at all rather than a confident wrong
 * one.
 */

import { describe, expect, it } from "vitest";
import { buildDecisionContext, saveMemory } from "./query-memory";
import type { KeryxDB, QueryMemoryEntry } from "../db/keryx-db";
import type { Citation } from "../types";

/** Only the two methods this module touches; the rest of KeryxDB is irrelevant here. */
function fakeDb(memories: QueryMemoryEntry[] = []) {
  const saved: QueryMemoryEntry[] = [];
  const db = {
    async loadQueryMemories(limit: number) {
      return memories.slice(0, limit);
    },
    async saveQueryMemory(entry: QueryMemoryEntry) {
      saved.push(entry);
    },
  };
  return { db: db as unknown as KeryxDB, saved };
}

function memory(
  id: string,
  topics: string[],
  sourcesRead: string[] | undefined,
  cited: Record<string, number> = {},
): QueryMemoryEntry {
  const sourceScores: QueryMemoryEntry["sourceScores"] = {};
  for (const [sid, weight] of Object.entries(cited)) {
    sourceScores[sid] = { name: sid, weight, reward: 0.001 };
  }
  return { id, sourceScores, sourcesRead, topics, createdAt: "2026-07-26T00:00:00.000Z" };
}

const SPECIALIST = { id: "spec", name: "Vitalik's Blog" };
const GENERALIST = { id: "gen", name: "Crypto Daily" };

/** Five runs about EIP-712 signing (the specialist earns every one it is read for) followed by
 *  fifteen about unrelated subjects (where only the generalist is read). */
function mixedCorpus(): QueryMemoryEntry[] {
  const out: QueryMemoryEntry[] = [];
  for (let i = 0; i < 5; i++) {
    out.push(memory(`sig-${i}`, ["eip", "signing"], ["spec", "gen"], { spec: 0.8, gen: 0.2 }));
  }
  for (let i = 0; i < 15; i++) {
    out.push(memory(`other-${i}`, ["compost", "tomato"], ["gen"], { gen: 0.9 }));
  }
  return out;
}

describe("buildDecisionContext — subject scoping", () => {
  it("scores a specialist on its own subject, not diluted by unrelated runs", async () => {
    const { db } = fakeDb(mixedCorpus());
    const ctx = await buildDecisionContext(db, "How does EIP-712 signing work?", [
      SPECIALIST,
      GENERALIST,
    ]);
    // Read in 5 of 5 relevant runs and cited in all 5 — not 5/20 as an all-topic denominator says.
    expect(ctx.sample).toBe(5);
    expect(ctx.memory).toContain("Vitalik's Blog: cited in 5 of 5 runs");
    expect(ctx.memory).toContain("100%");
    // The 15 gardening runs must not appear in any denominator.
    expect(ctx.memory).not.toContain("of 20 runs");
  });

  it("says nothing when the question shares no subject with any past run", async () => {
    const { db } = fakeDb(mixedCorpus());
    const ctx = await buildDecisionContext(db, "What is the best sourdough hydration?", [
      SPECIALIST,
      GENERALIST,
    ]);
    expect(ctx.memory).toBeUndefined();
    expect(ctx.reputation).toBeUndefined();
  });

  it("fills the scoring window with the closest matches, not merely the newest", async () => {
    // 60 runs share one incidental token; 6 are squarely on subject. The window is 60 wide, so
    // without ordering by overlap the on-subject runs would be crowded out by coincidence.
    const loose = Array.from({ length: 60 }, (_, i) =>
      memory(`loose-${i}`, ["signing", "compost"], ["gen"], { gen: 0.9 }),
    );
    const close = Array.from({ length: 6 }, (_, i) =>
      memory(`close-${i}`, ["eip", "signing", "typed"], ["spec"], { spec: 0.9 }),
    );
    const { db } = fakeDb([...loose, ...close]);
    const ctx = await buildDecisionContext(db, "What is EIP-712 typed-data signing?", [
      SPECIALIST,
      GENERALIST,
    ]);
    expect(ctx.memory).toContain("Vitalik's Blog");
  });

  it("matches a stored unstemmed topic against the stemmed question tokens", async () => {
    // Entries written before this module shared the archive tokeniser stored plurals as written.
    const legacyTopics = Array.from({ length: 5 }, (_, i) =>
      memory(`t-${i}`, ["transfers", "domains"], ["spec"], { spec: 0.7 }),
    );
    const { db } = fakeDb(legacyTopics);
    const ctx = await buildDecisionContext(db, "How does CCTP transfer USDC between domains?", [
      SPECIALIST,
    ]);
    expect(ctx.sample).toBe(5);
    expect(ctx.memory).toContain("Vitalik's Blog");
  });
});

describe("buildDecisionContext — the denominator", () => {
  it("reports a source that was read and never cited as negative evidence", async () => {
    const corpus = Array.from({ length: 6 }, (_, i) =>
      memory(`r-${i}`, ["x402", "toll"], ["spec", "gen"], { spec: 0.9 }),
    );
    const { db } = fakeDb(corpus);
    const ctx = await buildDecisionContext(db, "How does an x402 toll settle?", [
      SPECIALIST,
      GENERALIST,
    ]);
    expect(ctx.memory).toContain("Crypto Daily: read in 6 runs on this subject, never cited");
  });

  it("leaves a source that was never read on this subject out entirely", async () => {
    // A skip must never become evidence against the source it skipped, or one skip locks in the next.
    const corpus = Array.from({ length: 6 }, (_, i) =>
      memory(`r-${i}`, ["x402", "toll"], ["gen"], { gen: 0.9 }),
    );
    const { db } = fakeDb(corpus);
    const ctx = await buildDecisionContext(db, "How does an x402 toll settle?", [
      SPECIALIST,
      GENERALIST,
    ]);
    expect(ctx.memory).toContain("Crypto Daily");
    expect(ctx.memory).not.toContain("Vitalik's Blog");
  });

  it("ignores entries that predate the read column rather than reading them as empty", async () => {
    // Legacy rows can show a citation happened but never that a source was read and passed over.
    // Counting them would rebuild the positive-only bias inside a rate that looks rigorous.
    const legacy = Array.from({ length: 10 }, (_, i) =>
      memory(`old-${i}`, ["x402"], undefined, { spec: 0.9 }),
    );
    const { db } = fakeDb(legacy);
    const ctx = await buildDecisionContext(db, "How does x402 work?", [SPECIALIST]);
    expect(ctx.sample).toBe(0);
    expect(ctx.memory).toBeUndefined();
  });

  it("says nothing when too few relevant runs exist to support a rate", async () => {
    const thin = [
      memory("a", ["x402"], ["spec"], { spec: 1 }),
      memory("b", ["x402"], ["spec"], { spec: 1 }),
    ];
    const { db } = fakeDb(thin);
    const ctx = await buildDecisionContext(db, "How does x402 work?", [SPECIALIST]);
    expect(ctx.sample).toBe(2);
    expect(ctx.memory).toBeUndefined();
  });

  it("returns nothing when the run has no candidates to score", async () => {
    const { db } = fakeDb(mixedCorpus());
    const ctx = await buildDecisionContext(db, "How does EIP-712 signing work?", []);
    expect(ctx.memory).toBeUndefined();
  });
});

describe("buildDecisionContext — reputation", () => {
  it("ranks by citation rate times weight carried, on this subject", async () => {
    const corpus = Array.from({ length: 6 }, (_, i) =>
      memory(`r-${i}`, ["x402"], ["spec", "gen"], { spec: 0.9, ...(i < 2 ? { gen: 0.1 } : {}) }),
    );
    const { db } = fakeDb(corpus);
    const ctx = await buildDecisionContext(db, "How does x402 work?", [GENERALIST, SPECIALIST]);
    // spec: cited 6/6 at avg weight 0.9 → 90.  gen: cited 2/6 at avg weight 0.1 → 3.
    expect(ctx.reputation).toContain("Vitalik's Blog: reputation 90/100");
    expect(ctx.reputation).toContain("Crypto Daily: reputation 3/100");
    expect(ctx.reputation!.indexOf("Vitalik")).toBeLessThan(ctx.reputation!.indexOf("Crypto"));
  });
});

describe("saveMemory", () => {
  const citation = (sourceId: string): Citation =>
    ({ sourceId, sourceName: sourceId, weight: 0.5, reward: 0.002 }) as Citation;

  it("records a run that read sources and cited none of them", async () => {
    const { db, saved } = fakeDb();
    await saveMemory(db, "q1", "How does x402 settle?", [], ["spec", "gen"]);
    expect(saved).toHaveLength(1);
    expect(saved[0].sourcesRead).toEqual(["spec", "gen"]);
    expect(saved[0].sourceScores).toEqual({});
  });

  it("writes nothing when the run read nothing — it proves nothing either way", async () => {
    const { db, saved } = fakeDb();
    await saveMemory(db, "q2", "How does x402 settle?", [citation("spec")], []);
    expect(saved).toHaveLength(0);
  });

  it("stores stemmed subject tokens, not raw question words", async () => {
    const { db, saved } = fakeDb();
    await saveMemory(db, "q3", "How do agents handle USDC transfers?", [citation("spec")], ["spec"]);
    expect(saved[0].topics).toContain("agent"); // "agents" folded onto its singular
    expect(saved[0].topics).toContain("transfer");
    expect(saved[0].topics).not.toContain("how"); // a question word names no subject
  });
});
