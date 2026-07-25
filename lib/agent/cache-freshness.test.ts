/**
 * Cache freshness. What must never break: a copy the source has published past is never offered as
 * a free read (that is the bug that killed the fetch-toll rail), a quiet feed's cache stays valid
 * forever (nothing changed, so nothing is owed), and no bad or missing date can force a re-buy.
 */

import { describe, expect, it } from "vitest";
import { isCacheFresh, newestPublishedAt } from "./cache-freshness";
import type { SourceItem } from "../types";

const NOW = Date.parse("2026-07-26T00:00:00.000Z");
const CACHED = "2026-07-20T00:00:00.000Z";

function item(publishedAt?: string): SourceItem {
  return {
    id: `i-${publishedAt ?? "undated"}`,
    sourceId: "s",
    title: "t",
    summary: "s",
    content: "c",
    link: "https://example.test",
    publishedAt,
  };
}

describe("isCacheFresh", () => {
  it("is false when nothing is cached — there is no copy to read", () => {
    expect(isCacheFresh(null, "2026-07-01T00:00:00.000Z", NOW)).toBe(false);
  });

  it("is false once the source publishes after the copy was taken", () => {
    expect(isCacheFresh(CACHED, "2026-07-22T00:00:00.000Z", NOW)).toBe(false);
  });

  it("stays true for a feed that has published nothing since the copy", () => {
    expect(isCacheFresh(CACHED, "2026-07-19T23:59:59.000Z", NOW)).toBe(true);
  });

  it("treats a post dated exactly at the copy as already in it", () => {
    expect(isCacheFresh(CACHED, CACHED, NOW)).toBe(true);
  });

  it("ignores a future-dated post — a bad timezone must not force a re-buy every run", () => {
    expect(isCacheFresh(CACHED, "2027-01-01T00:00:00.000Z", NOW)).toBe(true);
  });

  it("keeps the copy when the source has no usable dates at all", () => {
    expect(isCacheFresh(CACHED, undefined, NOW)).toBe(true);
    expect(isCacheFresh(CACHED, "not a date", NOW)).toBe(true);
  });

  it("re-buys rather than guesses when the cache timestamp itself is unreadable", () => {
    expect(isCacheFresh("whenever", "2026-07-01T00:00:00.000Z", NOW)).toBe(false);
  });
});

describe("newestPublishedAt", () => {
  it("takes the first dated item, since getItems returns newest-first", () => {
    expect(newestPublishedAt([item("2026-07-22T00:00:00.000Z"), item("2026-07-01T00:00:00.000Z")])).toBe(
      "2026-07-22T00:00:00.000Z",
    );
  });

  it("skips undated leading rows instead of reporting no date at all", () => {
    expect(newestPublishedAt([item(undefined), item("2026-07-05T00:00:00.000Z")])).toBe(
      "2026-07-05T00:00:00.000Z",
    );
  });

  it("is undefined for an empty or wholly undated feed", () => {
    expect(newestPublishedAt([])).toBeUndefined();
    expect(newestPublishedAt([item(undefined)])).toBeUndefined();
  });
});
