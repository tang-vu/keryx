import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPublicBytes } from "../net/public-fetch";
import type { SourceItem } from "../types";
import { selectCurrentFeedCatalogItem, type CurrentFeedRecencyRequirement } from "./retained-recency-adapter";
import { createSourceRecencyFeedObserver, type SourceRecencyFeedObservation } from "./source-recency-feed";
import { RECENCY_FEED_URL, recencyAtomEntry, recencyAtomFeed, recencyRssItem, recencyRssFeed } from "./source-recency-feed-fixtures";
import { selectRelevantSourceItem, sourceItemIdentity } from "./source-item-asset";

vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: vi.fn() }));
const transport = vi.mocked(fetchPublicBytes);
const source = { id: "creator-source", rssUrl: RECENCY_FEED_URL, walletAddress: "original-registry-wallet", fetchPrice: 0.01 };
const currentXml = () => recencyAtomFeed(recencyAtomEntry("old", "2026-09-01T00:00:00Z") + recencyAtomEntry("new"));
const catalogItem = (overrides: Partial<SourceItem> = {}): SourceItem => ({ id: "actual-catalog-item-new", sourceId: source.id,
  title: "Release new", link: "https://publisher.example.test/new", publishedAt: "2026-10-07T12:00:00.000Z",
  summary: "Unrelated preview", content: "Actual bounded creator body", ...overrides });
async function observe(xml = currentXml()) {
  transport.mockResolvedValueOnce({ bytes: new TextEncoder().encode(xml), finalUrl: RECENCY_FEED_URL, contentType: "application/atom+xml" });
  const observer = createSourceRecencyFeedObserver();
  const read = await observer.observe({ scope: "current-feed", sourceId: source.id, feedUrl: RECENCY_FEED_URL });
  if (read.status !== "observed") throw new Error(`Fixture read failed: ${read.reason}`);
  const requirement: CurrentFeedRecencyRequirement = { kind: "newest-feed-entry", scope: "current-feed", criterion: "explicit-publication-date",
    sourceId: source.id, feedUrl: RECENCY_FEED_URL, runId: observer.runId };
  return { observation: read.observation, requirement };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00Z")); transport.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("trusted current-feed catalog adapter", () => {
  it("selects the actual newest catalog identity despite an older article's stronger topical score", async () => {
    const { observation, requirement } = await observe();
    const older = catalogItem({ id: "old", title: "Release old", summary: "Release Arc finality receipt evidence", link: "https://publisher.example.test/old",
      publishedAt: "2026-09-01T00:00:00.000Z" });
    const actual = catalogItem(), lookup = vi.fn().mockResolvedValue(actual);
    expect(selectRelevantSourceItem("Arc finality receipt evidence", [], [], [actual, older])).toBe(older);
    const selected = await selectCurrentFeedCatalogItem(requirement, observation, source, lookup);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(source.id, actual.link, undefined);
    expect(selected).toMatchObject({ status: "eligible", scope: "current-feed", criterion: "explicit-publication-date", membershipCount: 2,
      identity: sourceItemIdentity(actual), feedEntry: { nativeId: { rawValue: "urn:release:new" } } });
    if (selected.status !== "eligible") return;
    expect(selected.selected).toEqual(actual);
    expect(selected.selected).not.toBe(actual);
    expect(selected.identity.contentVersion).not.toBe(selected.feedEntry.entryMetadataVersion);
    expect(selected.identity.itemId).toBe("actual-catalog-item-new");
    actual.content = "Later mutation";
    expect(selected.selected.content).toBe("Actual bounded creator body");
    expect(source.walletAddress).toBe("original-registry-wallet");
    expect(selected).not.toHaveProperty("walletAddress"); expect(selected).not.toHaveProperty("fetchPrice");
  });
  it("refuses an unindexed current winner before offering an older retained article", async () => {
    const { observation, requirement } = await observe();
    const lookup = vi.fn().mockResolvedValue(null);
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, lookup)).toMatchObject({ status: "withheld", reason: "newest-entry-not-indexed",
      observation: { scope: "current-feed", sourceId: source.id, feedUrl: RECENCY_FEED_URL, membershipCount: 2 },
      feedEntry: { title: "Release new", itemUrl: "https://publisher.example.test/new", nativeId: { rawValue: "urn:release:new" },
        publication: { publishedAt: "2026-10-07T12:00:00.000Z" } } });
    expect(lookup).toHaveBeenCalledExactlyOnceWith(source.id, "https://publisher.example.test/new", undefined);
  });
  it("rejects legacy arrays, serialized objects and proxy copies as observation authority", async () => {
    const { observation, requirement } = await observe(), lookup = vi.fn();
    for (const value of [[catalogItem()], observation.entries, structuredClone(observation), new Proxy(observation, {})]) {
      expect(await selectCurrentFeedCatalogItem(requirement, value as unknown as SourceRecencyFeedObservation, source, lookup))
        .toEqual({ status: "withheld", reason: "observation-unqualified" });
    }
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    { scope: "frozen-retained-set" }, { criterion: "last-edit" }, { kind: "latest-version" },
  ])("requires explicit current-feed scope and publication criterion", async change => {
    const { observation, requirement } = await observe(), lookup = vi.fn();
    expect(await selectCurrentFeedCatalogItem({ ...requirement, ...change } as CurrentFeedRecencyRequirement, observation, source, lookup))
      .toMatchObject({ reason: "requirement-unqualified" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("refuses cross-run and exact source/feed binding mismatches", async () => {
    const { observation, requirement } = await observe(), lookup = vi.fn();
    expect(await selectCurrentFeedCatalogItem({ ...requirement, runId: "other-run" }, observation, source, lookup)).toMatchObject({ reason: "run-mismatch" });
    for (const change of [{ sourceId: "other-source" }, { feedUrl: "https://other.example.test/feed" }])
      expect(await selectCurrentFeedCatalogItem({ ...requirement, ...change }, observation, source, lookup)).toMatchObject({ reason: "source-mismatch" });
    expect(await selectCurrentFeedCatalogItem(requirement, observation, { ...source, rssUrl: "https://other.example.test/feed" }, lookup)).toMatchObject({ reason: "source-mismatch" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    recencyAtomFeed(recencyAtomEntry("missing", "", "<updated>2026-10-07T12:00:00Z</updated>") + recencyAtomEntry("new")),
    recencyAtomFeed(recencyAtomEntry("invalid", "2026-02-30T00:00:00Z") + recencyAtomEntry("new")),
    recencyAtomFeed(recencyAtomEntry("future", "2027-01-01T00:00:00Z") + recencyAtomEntry("new")),
    recencyAtomFeed(recencyAtomEntry("ambiguous", undefined, "<published>2026-10-06T12:00:00Z</published>") + recencyAtomEntry("new")),
    recencyRssFeed(recencyRssItem("missing", "") + recencyRssItem("new")),
  ])("retains uncertain members and refuses the entire newest selection", async xml => {
    const { observation, requirement } = await observe(xml), lookup = vi.fn();
    expect(observation.entries).toHaveLength(2);
    const result = await selectCurrentFeedCatalogItem(requirement, observation, source, lookup);
    expect(result).toMatchObject({ reason: "publication-unqualified" });
    expect(result).not.toHaveProperty("feedEntry");
    expect(lookup).not.toHaveBeenCalled();
  });
  it("refuses tied publication maxima without ordering by XML position or catalog relevance", async () => {
    const { observation, requirement } = await observe(recencyAtomFeed(recencyAtomEntry("one") + recencyAtomEntry("two"))), lookup = vi.fn();
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, lookup)).toMatchObject({ reason: "ambiguous-newest" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    recencyAtomFeed(recencyAtomEntry("same") + recencyAtomEntry("same", "2026-09-01T00:00:00Z")),
    recencyAtomFeed(recencyAtomEntry("one").replace("urn:release:one", "urn:release:two") + recencyAtomEntry("two", "2026-09-01T00:00:00Z")),
    recencyAtomFeed(recencyAtomEntry("one").replace('<id>urn:release:one</id>', "") + recencyAtomEntry("two")),
    recencyAtomFeed(recencyAtomEntry("one").replace('href="https://publisher.example.test/one"', 'href="/relative"') + recencyAtomEntry("two")),
  ])("refuses uncertain or duplicate feed item identities without silent filtering", async xml => {
    const { observation, requirement } = await observe(xml), lookup = vi.fn();
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, lookup)).toMatchObject({ reason: "entry-identity-unqualified" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("handles an empty feed and a future observation clock without an item lookup", async () => {
    const empty = await observe(recencyAtomFeed("")), lookup = vi.fn();
    expect(await selectCurrentFeedCatalogItem(empty.requirement, empty.observation, source, lookup)).toMatchObject({ reason: "empty-feed" });
    const current = await observe(); vi.setSystemTime(new Date("2026-10-08T11:00:00Z"));
    expect(await selectCurrentFeedCatalogItem(current.requirement, current.observation, source, lookup)).toMatchObject({ reason: "invalid-observation-time" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    { sourceId: "other-source" }, { link: "https://publisher.example.test/old" }, { title: "Edited title" },
    { publishedAt: undefined }, { publishedAt: "2026-09-01T00:00:00.000Z" }, { id: "" },
  ])("refuses a catalog item that conflicts with the actual feed winner", async change => {
    const { observation, requirement } = await observe();
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, vi.fn().mockResolvedValue(catalogItem(change))))
      .toMatchObject({ reason: "catalog-entry-conflict" });
  });
  it("refuses an array returned from lookup instead of assuming complete membership", async () => {
    const { observation, requirement } = await observe();
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, vi.fn().mockResolvedValue([catalogItem()])))
      .toMatchObject({ reason: "catalog-entry-conflict" });
  });
  it("requires a callback and contains catalog failures", async () => {
    const { observation, requirement } = await observe();
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, [] as unknown as Parameters<typeof selectCurrentFeedCatalogItem>[3]))
      .toMatchObject({ reason: "catalog-lookup-unqualified" });
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, vi.fn().mockRejectedValue(new Error("DB unavailable"))))
      .toMatchObject({ reason: "catalog-lookup-failed" });
  });
  it("preserves exact wanted source/item/content version and refuses substitutions", async () => {
    const { observation, requirement } = await observe(), item = catalogItem(), lookup = vi.fn().mockResolvedValue(item);
    const wanted = { sourceId: source.id, itemId: item.id, contentVersion: sourceItemIdentity(item).contentVersion };
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, lookup, { wanted })).toMatchObject({ status: "eligible" });
    for (const change of [{ sourceId: "other" }, { itemId: "old" }, { contentVersion: "ipfs:older" }])
      expect(await selectCurrentFeedCatalogItem(requirement, observation, source, lookup, { wanted: { ...wanted, ...change } }))
        .toMatchObject({ reason: "wanted-version-conflict" });
  });
  it("freezes the original wanted binding before asynchronous catalog lookup", async () => {
    const { observation, requirement } = await observe(), item = catalogItem();
    const wanted = { sourceId: source.id, itemId: "old", contentVersion: "older-version" };
    let resolve!: (value: SourceItem) => void;
    const lookup = vi.fn(() => new Promise<SourceItem>(done => { resolve = done; }));
    const pending = selectCurrentFeedCatalogItem(requirement, observation, source, lookup, { wanted });
    wanted.itemId = item.id; wanted.contentVersion = sourceItemIdentity(item).contentVersion;
    resolve(item);
    expect(await pending).toMatchObject({ reason: "wanted-version-conflict" });
  });
  it("cancels before and during catalog lookup without an article substitute", async () => {
    const { observation, requirement } = await observe(), ctrl = new AbortController(), lookup = vi.fn().mockImplementation(() => new Promise(() => {}));
    const pending = selectCurrentFeedCatalogItem(requirement, observation, source, lookup, { signal: ctrl.signal }); ctrl.abort();
    expect(await pending).toMatchObject({ reason: "cancelled" });
    lookup.mockClear();
    expect(await selectCurrentFeedCatalogItem(requirement, observation, source, lookup, { signal: ctrl.signal })).toMatchObject({ reason: "cancelled" });
    expect(lookup).not.toHaveBeenCalled();
  });
  it("bounds a nonresponsive catalog lookup without retrying it", async () => {
    const { observation, requirement } = await observe();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const lookup = vi.fn().mockImplementation(() => new Promise(() => {}));
    const pending = selectCurrentFeedCatalogItem(requirement, observation, source, lookup);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ reason: "catalog-lookup-failed" });
    expect(lookup).toHaveBeenCalledOnce();
  });
  it("uses native RSS publication fields and a precise existing IPFS article identity", async () => {
    const { observation, requirement } = await observe(recencyRssFeed(recencyRssItem("new")));
    const item = catalogItem({ content: "", ipfsCid: "bafy-actual-creator-version" });
    const selected = await selectCurrentFeedCatalogItem(requirement, observation, source, vi.fn().mockResolvedValue(item));
    expect(selected).toMatchObject({ status: "eligible", identity: { itemId: item.id, contentVersion: "ipfs:bafy-actual-creator-version" },
      feedEntry: { publication: { field: "rss:pubDate", rawValues: ["Wed, 07 Oct 2026 12:00:00 GMT"] } } });
  });
});
