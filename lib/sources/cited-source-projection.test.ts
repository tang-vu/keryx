import { describe, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import type { PublicSourceHistoryRow, RunPrivacyStore } from "../run-privacy/contracts";
import { PrivacyError } from "../run-privacy/contracts";
import { loadCitedSourceHistory } from "./cited-source-history";
import { loadSourceDirectory } from "./source-directory";
import type { KeryxDB } from "../db/keryx-db";

const entry: PublicSourceHistoryRow = { id: "public", createdAt: "2026-11-04T00:00:00Z", hasAnswer: true,
  citations: [{ sourceName: "Recorded publisher", sourceKind: "public-reference",
    itemUrl: "https://docs.example/original#part", itemTitle: "Original title", publicDeliveryKind: "excerpt" }] };
const full = { ...entry, answer: "Original answer", question: "Private original question", trace: [{ private: "trace" }] } as unknown as QueryRun;
function supported(rows: unknown = [entry]) {
  const sourceHistory = vi.fn(async () => rows), listRecentQueries = vi.fn(async () => { throw Error("Full reader must not run"); });
  return { sourceHistory, db: { runPrivacyActive: true, runPrivacy: { sourceHistory } as unknown as RunPrivacyStore, listRecentQueries } };
}

describe("citation source loader optional storage projection", () => {
  it("uses exactly one supported source snapshot with unchanged public card output", async () => {
    const f = supported(), snapshot = JSON.stringify(entry);
    const old = await loadCitedSourceHistory({ runPrivacyActive: false, listRecentQueries: async () => [full] });
    expect(await loadCitedSourceHistory(f.db)).toEqual(old);
    expect(f.sourceHistory).toHaveBeenCalledExactlyOnceWith(); expect(f.db.listRecentQueries).not.toHaveBeenCalled();
    expect(JSON.stringify(entry)).toBe(snapshot);
    expect(JSON.stringify(old)).not.toContain("Private original"); expect(JSON.stringify(old)).not.toContain("trace");
  });
  it("retains the exact legacy request when privacy reads are inactive", async () => {
    const f = supported(); f.db.runPrivacyActive = false;
    const listRecentQueries = vi.fn(async () => [full]);
    expect((await loadCitedSourceHistory({ ...f.db, listRecentQueries })).entries).toHaveLength(1);
    expect(listRecentQueries).toHaveBeenCalledExactlyOnceWith(50); expect(f.sourceHistory).not.toHaveBeenCalled();
  });
  it("keeps an unsupported active adapter's existing guarded full-reader path", async () => {
    const list = vi.fn(async (_query: { take: number }) => [full]), listRecentQueries = vi.fn(async (take: number) => list({ take }));
    const runPrivacy = { list } as unknown as RunPrivacyStore;
    expect((await loadCitedSourceHistory({ runPrivacyActive: true, runPrivacy, listRecentQueries })).entries).toHaveLength(1);
    expect(listRecentQueries).toHaveBeenCalledExactlyOnceWith(50); expect(list).toHaveBeenCalledExactlyOnceWith({ take: 50 });
  });
  it("refuses an active missing privacy port before any full-reader fallback", async () => {
    const listRecentQueries = vi.fn(async () => [full]);
    await expect(loadCitedSourceHistory({ runPrivacyActive: true, listRecentQueries })).rejects.toThrow(PrivacyError);
    expect(listRecentQueries).not.toHaveBeenCalled();
  });
  it("preserves a supported refusal and reports history unavailable independently of other sections", async () => {
    const f = supported(), refusal = new PrivacyError("privacy_unavailable"); f.sourceHistory.mockRejectedValue(refusal);
    await expect(loadCitedSourceHistory(f.db)).rejects.toBe(refusal);
    const db = { ...f.db, listSources: async () => [], listPublicReferences: async () => [], creatorLeaderboard: async () => [] } as unknown as KeryxDB;
    expect(await loadSourceDirectory(db)).toMatchObject({ registry: { status: "ready" }, publicReferences: { status: "ready" },
      earningsStatus: "ready", citedSources: { status: "unavailable", entries: [], runCount: 0 } });
    expect(f.db.listRecentQueries).not.toHaveBeenCalled();
  });
  it.each([
    null, {}, Array(51).fill(entry), [{ ...entry, hasAnswer: "true" }], [{ ...entry, citations: Array(101).fill({}) }],
    [{ ...entry, answer: "Unexpected original prose" }], [{ ...entry, id: "bad id" }],
  ].map(rows => ({ rows })))("rejects a malformed supported snapshot without changing the reader: %j", async ({ rows }) => {
    const f = supported(rows); await expect(loadCitedSourceHistory(f.db)).rejects.toThrow();
    expect(f.db.listRecentQueries).not.toHaveBeenCalled(); expect(f.sourceHistory).toHaveBeenCalledOnce();
  });
  it("keeps reserved private IDs, invalid dates and absent answers out of document cards", async () => {
    const f = supported([entry, { ...entry, id: "prv_secret" }, { ...entry, id: "bad_date", createdAt: "invalid" },
      { ...entry, id: "uncited", hasAnswer: false }]);
    expect(await loadCitedSourceHistory(f.db)).toMatchObject({ runCount: 2, entries: [{ runId: "public" }] });
  });
});
