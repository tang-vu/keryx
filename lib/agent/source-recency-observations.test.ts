import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPublicBytes } from "../net/public-fetch";
import type { SourceItem } from "../types";
import { recognizeSourceRecency, sourceRecencyGap, type SourceRecencyRequirement } from "../sources/source-recency";
import { isObservedSourceRecencyFeed } from "../sources/source-recency-feed";
import { RECENCY_FEED_URL, recencyAtomEntry, recencyAtomFeed } from "../sources/source-recency-feed-fixtures";
import { sourceItemIdentity } from "../sources/source-item-asset";
import { createSourceRecencyResolver } from "./source-recency-observations";

vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: vi.fn() }));
const transport = vi.mocked(fetchPublicBytes);
const source = { id: "creator", name: "Creator releases", rssUrl: RECENCY_FEED_URL, url: "https://publisher.example.test/" };
const requirement = () => recognizeSourceRecency(`Name the newest release in ${RECENCY_FEED_URL}, state one change and one missing compatibility fact.`)!;
const item = (sourceId = source.id): SourceItem => ({ id: "actual-indexed-new", sourceId, title: "Release new",
  summary: "Private preview", content: "SECRET_CREATOR_BODY", itemKeyEnc: "SECRET_ITEM_KEY",
  link: "https://publisher.example.test/new", publishedAt: "2026-10-07T12:00:00.000Z" });
const xml = () => recencyAtomFeed(recencyAtomEntry("old", "2026-09-01T12:00:00Z") + recencyAtomEntry("new"));
function nativeResponse(body = xml()) { return { bytes: new TextEncoder().encode(body), finalUrl: RECENCY_FEED_URL, contentType: "application/atom+xml" }; }

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00Z")); transport.mockReset().mockResolvedValue(nativeResponse()); });
afterEach(() => { vi.useRealTimers(); });

describe("trusted run-scoped current feed resolver", () => {
  it("returns an actual eligible catalog item with safe metadata and no payment authority", async () => {
    const actual = item(), lookup = vi.fn().mockResolvedValue(actual);
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 });
    const outcome = await resolver.resolve({ ...source, walletAddress: "SECRET_PAYEE", fetchPrice: 999 } as typeof source, lookup);
    expect(outcome).toMatchObject({ status: "eligible", identity: sourceItemIdentity(actual), selected: actual,
      observation: { scope: "current-feed", criterion: "explicit-publication-date", sourceId: source.id,
        feedUrl: RECENCY_FEED_URL, membership: "complete-document", membershipCount: 2, filteredCount: 0, truncated: false,
        newestEntry: { title: "Release new", itemUrl: actual.link, nativeId: { field: "atom:id", rawValue: "urn:release:new" },
          publication: { field: "atom:published", rawValue: "2026-10-07T12:00:00Z", publishedAt: actual.publishedAt } } } });
    expect(resolver.readsUsed).toBe(1);
    if (outcome.status !== "eligible") return;
    const safe = JSON.stringify(outcome.observation);
    for (const privateValue of ["SECRET_CREATOR_BODY", "SECRET_ITEM_KEY", "SECRET_PAYEE", "fetchPrice", "walletAddress", "requestScope", "runId", "entries", "contentVersion"])
      expect(safe).not.toContain(privateValue);
    expect(Object.isFrozen(outcome.observation.newestEntry.publication)).toBe(true);
    expect(isObservedSourceRecencyFeed(outcome.observation)).toBe(false);
  });
  it("memoizes one promise and frozen outcome across concurrent and later CACHE/BUY/reevaluation", async () => {
    const lookup = vi.fn().mockResolvedValue(item()), alternateLookup = vi.fn().mockResolvedValue(item());
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 });
    const first = resolver.resolve(source, lookup), concurrent = resolver.resolve({ ...source }, alternateLookup);
    expect(concurrent).toBe(first);
    const outcome = await first;
    expect(await resolver.resolve(source, alternateLookup)).toBe(outcome);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(transport).toHaveBeenCalledOnce(); expect(lookup).toHaveBeenCalledOnce(); expect(alternateLookup).not.toHaveBeenCalled();
    expect(resolver.readsUsed).toBe(1);
  });
  it("memoizes transport failure without retry or item fallback", async () => {
    transport.mockRejectedValueOnce(new Error("No feed"));
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 }), lookup = vi.fn();
    const outcome = await resolver.resolve(source, lookup);
    expect(outcome).toMatchObject({ status: "withheld", gap: { reason: "feed-read-failed", sourceId: source.id } });
    expect(await resolver.resolve(source, lookup)).toBe(outcome);
    expect(transport).toHaveBeenCalledOnce(); expect(lookup).not.toHaveBeenCalled(); expect(resolver.readsUsed).toBe(1);
  });
  it("keeps an unindexed winner as a precise safe gap instead of selecting an older row", async () => {
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 }), lookup = vi.fn().mockResolvedValue(null);
    const outcome = await resolver.resolve(source, lookup);
    expect(outcome).toMatchObject({ status: "withheld", gap: { reason: "newest-entry-not-indexed", sourceId: source.id,
      observation: { membershipCount: 2, newestEntry: { title: "Release new", itemUrl: "https://publisher.example.test/new" } } } });
    expect(lookup).toHaveBeenCalledExactlyOnceWith(source.id, "https://publisher.example.test/new", undefined);
    expect(JSON.stringify(outcome)).not.toContain("SECRET");
    expect(await resolver.resolve(source, lookup)).toBe(outcome);
  });
  it.each([false, undefined])("disabled/private or omitted enablement preserves old holds with no GET: %s", async enabled => {
    const required = requirement(), resolver = createSourceRecencyResolver(required, { enabled, maxReads: 1 }), lookup = vi.fn();
    expect(await resolver.resolve(source, lookup)).toEqual({ status: "withheld", gap: sourceRecencyGap(required, source) });
    expect(transport).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled(); expect(resolver.readsUsed).toBe(0);
  });
  it.each([
    `Name the newest stable release in ${RECENCY_FEED_URL}.`,
    `Name the newest release before 2026-10-01 in ${RECENCY_FEED_URL}.`,
    `Name the newest release in ${RECENCY_FEED_URL} among retained cached entries.`,
    `Name the newest release in ${RECENCY_FEED_URL} and https://other.example.test/feed.`,
    "Name the newest release of an unspecified publication",
  ])("unsupported or unresolved original criteria retain holds without GET: %s", async question => {
    const required = recognizeSourceRecency(question)!, resolver = createSourceRecencyResolver(required, { enabled: true, maxReads: 1 }), lookup = vi.fn();
    expect(required.status).toBe("unsupported");
    expect(await resolver.resolve(source, lookup)).toEqual({ status: "withheld", gap: sourceRecencyGap(required, source) });
    expect(transport).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled(); expect(resolver.readsUsed).toBe(0);
  });
  it("keeps ordinary or unrelated sources unaffected without GET or catalog lookup", async () => {
    const lookup = vi.fn(), ordinary = createSourceRecencyResolver(null, { enabled: true, maxReads: 1 });
    expect(await ordinary.resolve(source, lookup)).toEqual({ status: "unaffected" });
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 });
    expect(await resolver.resolve({ ...source, rssUrl: "https://unrelated.example.test/feed" }, lookup)).toEqual({ status: "unaffected" });
    expect(transport).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled(); expect(resolver.readsUsed).toBe(0);
  });
  it("refuses a legacy resource-only match without inventing RSS enrollment or GET", async () => {
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 });
    expect(await resolver.resolve({ ...source, rssUrl: undefined, url: RECENCY_FEED_URL }, vi.fn())).toMatchObject({ status: "withheld", gap: { reason: "source-mismatch" } });
    expect(transport).not.toHaveBeenCalled(); expect(resolver.readsUsed).toBe(0);
  });
  it("reports exhausted existing grants without increasing attention or reading an article", async () => {
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 0 }), lookup = vi.fn();
    expect(await resolver.resolve(source, lookup)).toMatchObject({ status: "withheld", gap: { reason: "read-cap-exhausted" } });
    expect(transport).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled(); expect(resolver.readsUsed).toBe(0);
  });
  it("freezes original caller and source views before asynchronous work", async () => {
    const mutable = { ...requirement(), feedUrls: [RECENCY_FEED_URL] }, mutableSource = { ...source };
    const resolver = createSourceRecencyResolver(mutable, { enabled: true, maxReads: 1 });
    mutable.feedUrls[0] = "https://other.example.test/feed"; mutable.status = "unsupported";
    const pending = resolver.resolve(mutableSource, vi.fn().mockResolvedValue(item()));
    mutableSource.rssUrl = "https://other.example.test/feed";
    expect(await pending).toMatchObject({ status: "eligible", observation: { feedUrl: RECENCY_FEED_URL } });
  });
  it.each([{ name: "Other name" }, { rssUrl: "https://other.example.test/feed" }, { url: "https://other.example.test/" }])
    ("refuses inconsistent same-ID source views without a second GET: %s", async change => {
      const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 }), lookup = vi.fn().mockResolvedValue(item());
      const first = await resolver.resolve(source, lookup);
      const mismatch = await resolver.resolve({ ...source, ...change }, lookup);
      expect(mismatch).toMatchObject({ status: "withheld", gap: { reason: "source-mismatch", sourceName: source.name } });
      expect(await resolver.resolve({ ...source, ...change }, lookup)).toBe(mismatch);
      expect(await resolver.resolve(source, lookup)).toBe(first);
      expect(transport).toHaveBeenCalledOnce(); expect(lookup).toHaveBeenCalledOnce();
    });
  it("cancels before observer admission with no GET and memoizes the refusal", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1, signal: ctrl.signal }), lookup = vi.fn();
    const outcome = await resolver.resolve(source, lookup);
    expect(outcome).toMatchObject({ status: "withheld", gap: { reason: "cancelled" } });
    expect(await resolver.resolve(source, lookup)).toBe(outcome);
    expect(transport).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled();
  });
  it("cancels an active probe without catalog lookup or a replacement source", async () => {
    const ctrl = new AbortController();
    transport.mockImplementation((_url, limits) => new Promise((_resolve, reject) => limits!.signal!.addEventListener("abort", () => reject(new Error("abort")), { once: true })));
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1, signal: ctrl.signal }), lookup = vi.fn();
    const pending = resolver.resolve(source, lookup);
    await Promise.resolve(); ctrl.abort();
    expect(await pending).toMatchObject({ status: "withheld", gap: { reason: "cancelled" } });
    expect(lookup).not.toHaveBeenCalled(); expect(resolver.readsUsed).toBe(1);
  });
  it("does not promote legacy arrays or uncertain native rows into current cohort authority", async () => {
    const lookup = vi.fn().mockResolvedValue(item());
    transport.mockResolvedValueOnce(nativeResponse(recencyAtomFeed(recencyAtomEntry("old", "", "<updated>2026-10-08T10:00:00Z</updated>") + recencyAtomEntry("new"))));
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 });
    expect(await resolver.resolve(source, lookup)).toMatchObject({ status: "withheld", gap: { reason: "publication-unqualified" } });
    expect(lookup).not.toHaveBeenCalled();
    const another = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 });
    expect(await another.resolve(source, [item()] as unknown as Parameters<typeof another.resolve>[1]))
      .toMatchObject({ status: "withheld", gap: { reason: "catalog-lookup-unqualified" } });
  });
  it("a bounded public-reference lookup is item membership only; native feed remains the cohort", async () => {
    const publicSource = { ...source, id: "public:reference" }, actual = item(publicSource.id);
    const stored = [actual];
    const lookup = vi.fn(async (sourceId: string, exactUrl: string) => stored.find(row => row.sourceId === sourceId && row.link === exactUrl) ?? null);
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1 });
    expect(await resolver.resolve(publicSource, lookup)).toMatchObject({ status: "eligible", selected: actual, observation: { membershipCount: 2 } });
    expect(stored).toHaveLength(1); expect(resolver.readsUsed).toBe(1);
  });
  it("keeps exact wanted version conflicts closed and exposes no misleading winner metadata", async () => {
    const resolver = createSourceRecencyResolver(requirement(), { enabled: true, maxReads: 1,
      wanted: { sourceId: source.id, itemId: "older-item", contentVersion: "older-version" } });
    const outcome = await resolver.resolve(source, vi.fn().mockResolvedValue(item()));
    expect(outcome).toMatchObject({ status: "withheld", gap: { reason: "wanted-version-conflict" } });
    expect(outcome).not.toHaveProperty("gap.observation");
  });
  it("does not use a mutated opt-in or wanted binding after resolver creation", async () => {
    const options = { enabled: false, maxReads: 1 }, required = requirement();
    const resolver = createSourceRecencyResolver(required, options); options.enabled = true;
    expect(await resolver.resolve(source, vi.fn())).toEqual({ status: "withheld", gap: sourceRecencyGap(required, source) });
    expect(transport).not.toHaveBeenCalled();
  });
  it("requires the exact single-feed binding despite a malformed trusted adapter requirement", async () => {
    const fake = { ...requirement(), feedUrls: [RECENCY_FEED_URL, "https://other.example.test/feed"] } as SourceRecencyRequirement;
    const resolver = createSourceRecencyResolver(fake, { enabled: true, maxReads: 1 });
    expect(await resolver.resolve(source, vi.fn())).toMatchObject({ status: "withheld", gap: { reason: "newest-feed-observation-unqualified" } });
    expect(transport).not.toHaveBeenCalled();
  });
});
