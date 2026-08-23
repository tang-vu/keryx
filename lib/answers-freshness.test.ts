/**
 * Answer freshness. What must never break: the note only counts material a re-ask could actually
 * buy, it never invents newness from a bad date, and the denominator it quotes is the number of
 * cited sources still on sale.
 */

import { describe, expect, it } from "vitest";
import {
  citedSourceIds,
  clampedNewest,
  freshnessOf,
  hasNewMaterial,
  loadFreshness,
} from "./answers-freshness";
import type { Citation } from "./types";
import type { KeryxDB } from "./db/keryx-db";

function cite(sourceId: string, name = sourceId, marker = "S1"): Citation {
  return { marker, sourceId, sourceName: name, weight: 1, reward: 0.001, rationale: "" };
}

const emptyVersionAudit = {
  versionedCitations: 0,
  currentVersions: 0,
  supersededVersions: 0,
  unavailableVersions: 0,
  versions: [],
  unavailableSourceChecks: 0,
  publicationCheck: "not_applicable" as const,
};

describe("citedSourceIds", () => {
  it("collapses several markers on one source into a single id, in first-cited order", () => {
    expect(
      citedSourceIds([cite("b", "B", "S1"), cite("a", "A", "S2"), cite("b", "B", "S3")]),
    ).toEqual(["b", "a"]);
  });

  it("drops citations with no source id", () => {
    expect(citedSourceIds([{ ...cite("a"), sourceId: "" }])).toEqual([]);
  });
});

describe("freshnessOf", () => {
  it("reports only the sources that moved, busiest first, but counts every cited source", () => {
    const f = freshnessOf([cite("a", "Alpha"), cite("b", "Beta"), cite("c", "Gamma")], {
      a: 1,
      c: 4,
    });
    expect(f.citedCount).toBe(3);
    expect(f.newItems).toBe(5);
    expect(f.sources.map((s) => s.name)).toEqual(["Gamma", "Alpha"]);
  });

  it("is a quiet 'still current' when nothing has been published", () => {
    const f = freshnessOf([cite("a", "Alpha")], {}, new Set(["a"]));
    expect(f).toEqual({
      citedCount: 1,
      watchedCount: 1,
      newItems: 0,
      sources: [],
      ...emptyVersionAudit,
    });
  });

  /** Silence from a source nobody polls is not evidence — the note must be able to tell them apart. */
  it("counts only followed sources as watched", () => {
    const f = freshnessOf([cite("a"), cite("b"), cite("c")], {}, new Set(["a", "c", "stranger"]));
    expect(f.citedCount).toBe(3);
    expect(f.watchedCount).toBe(2);
  });

  it("ignores counts for sources this dispatch never cited", () => {
    expect(freshnessOf([cite("a")], { a: 2, stranger: 99 }).newItems).toBe(2);
  });

  it("counts a source once even when it carries several citation markers", () => {
    const f = freshnessOf([cite("a", "Alpha", "S1"), cite("a", "Alpha", "S2")], { a: 3 });
    expect(f.citedCount).toBe(1);
    expect(f.newItems).toBe(3);
    expect(f.sources).toHaveLength(1);
  });
});

describe("hasNewMaterial", () => {
  const settled = "2026-07-20T00:00:00.000Z";
  const now = Date.parse("2026-07-25T00:00:00.000Z");

  it("is true when a cited source published after the dispatch", () => {
    expect(hasNewMaterial([cite("a")], { a: "2026-07-22T00:00:00.000Z" }, settled, now)).toBe(true);
  });

  it("is false when the newest post predates the dispatch", () => {
    expect(hasNewMaterial([cite("a")], { a: "2026-07-19T00:00:00.000Z" }, settled, now)).toBe(false);
  });

  /** A feed with a timezone bug must not pin an answer to "stale" for good. */
  it("ignores posts dated in the future", () => {
    expect(hasNewMaterial([cite("a")], { a: "2027-01-01T00:00:00.000Z" }, settled, now)).toBe(false);
  });

  it("ignores sources with no usable date, and unknown ids", () => {
    expect(hasNewMaterial([cite("a")], { a: "not a date" }, settled, now)).toBe(false);
    expect(hasNewMaterial([cite("a")], {}, settled, now)).toBe(false);
  });

  it("proves nothing when the run's own date is unreadable", () => {
    expect(hasNewMaterial([cite("a")], { a: "2026-07-22T00:00:00.000Z" }, "???", now)).toBe(false);
  });
});

describe("clampedNewest", () => {
  const now = Date.parse("2026-07-25T00:00:00.000Z");
  it("rejects absent, unparseable and future dates; accepts a real one", () => {
    expect(clampedNewest(undefined, now)).toBeNull();
    expect(clampedNewest("", now)).toBeNull();
    expect(clampedNewest("whenever", now)).toBeNull();
    expect(clampedNewest("2026-07-26T00:00:00.000Z", now)).toBeNull();
    expect(clampedNewest("2026-07-24T00:00:00.000Z", now)).toBe(
      Date.parse("2026-07-24T00:00:00.000Z"),
    );
  });
});

/** A stand-in adapter: cited sources that all list a feed unless a test says otherwise. */
function stubDb(
  overrides: Partial<
    Record<string, { active?: boolean; verified?: boolean; rssUrl?: string | undefined }>
  > = {},
) {
  const calls: { ids: string[]; since: string; until: string }[] = [];
  const db = {
    async getSource(id: string) {
      if (id === "gone") return null;
      return {
        id,
        name: id,
        url: "",
        description: "",
        rssUrl: `https://feed.test/${id}.xml`,
        walletAddress: "0x",
        fetchPrice: 0.002,
        tags: [],
        authors: [],
        createdAt: "2026-07-01T00:00:00.000Z",
        ...(overrides[id] ?? {}),
      };
    },
    async countItemsPublishedBetween(ids: string[], since: string, until: string) {
      calls.push({ ids: [...ids].sort(), since, until });
      return Object.fromEntries(ids.map((id) => [id, 2]));
    },
    async getItem() {
      return null;
    },
  };
  return { db: db as unknown as KeryxDB, calls };
}

describe("loadFreshness", () => {
  const run = { citations: [cite("a"), cite("b")], createdAt: "2026-07-20T00:00:00.000Z" };
  const now = Date.parse("2026-07-25T00:00:00.000Z");

  it("counts inside (settled, now] for the cited sources", async () => {
    const { db, calls } = stubDb();
    const f = await loadFreshness(db, run, now);
    expect(calls).toEqual([
      { ids: ["a", "b"], since: run.createdAt, until: "2026-07-25T00:00:00.000Z" },
    ]);
    expect(f).toMatchObject({ citedCount: 2, newItems: 4, publicationCheck: "complete" });
  });

  it("drops a delisted source from both the count and the denominator", async () => {
    const { db, calls } = stubDb({ b: { active: false } });
    const f = await loadFreshness(db, run, now);
    expect(calls[0].ids).toEqual(["a"]);
    expect(f.citedCount).toBe(1);
    expect(f.sources.map((s) => s.sourceId)).toEqual(["a"]);
  });

  it("drops an unverified source — the agent would not read it either", async () => {
    const { db } = stubDb({ a: { verified: false } });
    expect((await loadFreshness(db, run, now)).citedCount).toBe(1);
  });

  it("says nothing at all when no cited source is still on sale", async () => {
    const { db, calls } = stubDb();
    const f = await loadFreshness(db, { citations: [cite("gone")], createdAt: run.createdAt }, now);
    expect(f).toEqual({
      citedCount: 0,
      watchedCount: 0,
      newItems: 0,
      sources: [],
      ...emptyVersionAudit,
    });
    expect(calls).toEqual([]); // no point querying items for a source nobody can buy
  });

  it("skips the queries entirely for a dispatch that cited nothing", async () => {
    const { db, calls } = stubDb();
    expect(await loadFreshness(db, { citations: [], createdAt: run.createdAt }, now)).toEqual({
      citedCount: 0,
      watchedCount: 0,
      newItems: 0,
      sources: [],
      ...emptyVersionAudit,
    });
    expect(calls).toEqual([]);
  });

  /**
   * A source with no feed is never re-read, so a "nothing new" note over it would be a claim Keryx
   * has no way to make. The component renders nothing when watchedCount is 0 — this is what tells
   * it apart from "watched, and genuinely quiet".
   */
  it("marks a feedless source as unwatched, while still counting it as cited", async () => {
    const { db } = stubDb({ b: { rssUrl: undefined } });
    const f = await loadFreshness(db, run, now);
    expect(f.citedCount).toBe(2);
    expect(f.watchedCount).toBe(1);
  });

  it("keeps a source lookup failure visible instead of calling it absent or current", async () => {
    const { db: base } = stubDb();
    const db = {
      ...base,
      async getSource(id: string) {
        if (id === "a") throw new Error("source store unavailable");
        return base.getSource(id);
      },
    } as KeryxDB;
    const f = await loadFreshness(db, run, now);
    expect(f).toMatchObject({ citedCount: 1, unavailableSourceChecks: 1 });
  });

  it("contains a publication query failure as unavailable rather than a false quiet feed", async () => {
    const { db: base } = stubDb();
    const db = {
      ...base,
      countItemsPublishedBetween: async () => Promise.reject(new Error("items unavailable")),
    } as KeryxDB;
    const f = await loadFreshness(db, run, now);
    expect(f).toMatchObject({
      citedCount: 2,
      newItems: 0,
      publicationCheck: "unavailable",
    });
  });
});
