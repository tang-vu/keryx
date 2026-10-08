import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPublicBytes } from "../net/public-fetch";
import { createSourceRecencyFeedObserver, isObservedSourceRecencyFeed } from "./source-recency-feed";
import { RECENCY_FEED_URL, recencyAtomEntry, recencyAtomFeed, recencyRssFeed, recencyRssItem } from "./source-recency-feed-fixtures";
import { parseSourceRecencyFeed, SOURCE_RECENCY_FEED_LIMITS } from "./source-recency-feed-parser";

vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: vi.fn() }));
const transport = vi.mocked(fetchPublicBytes);
const scope = { scope: "current-feed" as const, sourceId: "creator-source", feedUrl: RECENCY_FEED_URL };
const xml = recencyAtomFeed(recencyAtomEntry("new"));
const response = () => ({ bytes: new TextEncoder().encode(xml), finalUrl: RECENCY_FEED_URL, contentType: "application/atom+xml" });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00Z")); transport.mockReset(); transport.mockResolvedValue(response()); });
afterEach(() => { vi.useRealTimers(); });

describe("bounded per-run feed observation", () => {
  it("mints a coherent frozen current-feed observation through the shared guarded transport", async () => {
    const observer = createSourceRecencyFeedObserver();
    const read = await observer.observe(scope);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith(RECENCY_FEED_URL, expect.objectContaining({
      maxBytes: 2_000_000, timeoutMs: 8000, maxHops: 0, requireFullResponse: true, signal: expect.any(AbortSignal),
      allowedContentTypes: ["application/atom+xml", "application/rss+xml", "application/xml", "text/xml"],
    }));
    expect(observer.readsUsed).toBe(1);
    expect(read.status).toBe("observed");
    if (read.status !== "observed") return;
    expect(read.observation).toMatchObject({ requestScope: { ...scope, runId: observer.runId },
      readStartedAt: "2026-10-08T12:00:00.000Z", capturedAt: "2026-10-08T12:00:00.000Z",
      membership: "complete-document", filteredCount: 0, truncated: false,
      rawByteCount: Buffer.byteLength(xml), rawBodySha256: createHash("sha256").update(xml).digest("hex") });
    expect(isObservedSourceRecencyFeed(read.observation)).toBe(true);
    expect(Object.isFrozen(read.observation)).toBe(true);
    expect(Object.isFrozen(read.observation.requestScope)).toBe(true);
    expect(Object.isFrozen(read.observation.entries)).toBe(true);
    expect(isObservedSourceRecencyFeed(structuredClone(read.observation))).toBe(false);
    expect(isObservedSourceRecencyFeed(new Proxy(read.observation, {}))).toBe(false);
    expect(isObservedSourceRecencyFeed(await parseSourceRecencyFeed(xml))).toBe(false);
    expect(isObservedSourceRecencyFeed(read.observation.entries)).toBe(false);
  });
  it("reserves concurrent reads atomically and refuses a duplicate probe without new transport", async () => {
    const observer = createSourceRecencyFeedObserver({ maxReads: 1 });
    const first = observer.observe(scope);
    const second = await observer.observe({ ...scope, feedUrl: "https://other.example.test/feed" });
    expect(second).toEqual({ status: "withheld", reason: "read-cap-exhausted" });
    expect(await observer.observe(scope)).toEqual({ status: "withheld", reason: "duplicate-probe" });
    await first;
    expect(transport).toHaveBeenCalledOnce();
  });
  it("consumes failed transport reads instead of allowing unbounded retries", async () => {
    transport.mockRejectedValueOnce(new Error("DNS refused"));
    const observer = createSourceRecencyFeedObserver();
    expect(await observer.observe(scope)).toEqual({ status: "withheld", reason: "feed-read-failed" });
    expect(await observer.observe(scope)).toEqual({ status: "withheld", reason: "duplicate-probe" });
    expect(observer.readsUsed).toBe(1);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("rejects zero grant, malformed addresses, credentials and retained scope before transport", async () => {
    expect(await createSourceRecencyFeedObserver({ maxReads: 0 }).observe(scope)).toMatchObject({ reason: "read-cap-exhausted" });
    const observer = createSourceRecencyFeedObserver();
    for (const feedUrl of ["file:///local.xml", "https://u:p@example.test/f", `${RECENCY_FEED_URL}#fragment`, "not a URL", "https://example.test/\ud800", "https://example.test\\other/feed"])
      expect(await observer.observe({ ...scope, feedUrl })).toMatchObject({ reason: "request-scope-unqualified" });
    expect(await observer.observe({ ...scope, scope: "retained-set" } as unknown as typeof scope)).toMatchObject({ reason: "request-scope-unqualified" });
    expect(transport).not.toHaveBeenCalled();
    expect(observer.readsUsed).toBe(0);
  });
  it.each([-1, 1.5, 5, NaN, Infinity])("refuses invalid grants %s", maxReads => {
    expect(() => createSourceRecencyFeedObserver({ maxReads })).toThrow("Invalid feed read grant");
  });
  it("cancels before DNS/HTTP without consuming a read", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    const observer = createSourceRecencyFeedObserver();
    expect(await observer.observe(scope, { signal: ctrl.signal })).toMatchObject({ reason: "cancelled" });
    expect(transport).not.toHaveBeenCalled(); expect(observer.readsUsed).toBe(0);
  });
  it("propagates cancellation to active guarded transport and consumes the read", async () => {
    transport.mockImplementation((_url, limits) => new Promise((_resolve, reject) => {
      limits!.signal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const ctrl = new AbortController(), observer = createSourceRecencyFeedObserver();
    const pending = observer.observe(scope, { signal: ctrl.signal }); ctrl.abort();
    expect(await pending).toMatchObject({ reason: "cancelled" });
    expect(observer.readsUsed).toBe(1);
  });
  it("enforces an overall parse/read deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    transport.mockImplementation((_url, limits) => new Promise((_resolve, reject) => {
      limits!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const pending = createSourceRecencyFeedObserver().observe(scope);
    await vi.advanceTimersByTimeAsync(SOURCE_RECENCY_FEED_LIMITS.timeoutMs);
    expect(await pending).toMatchObject({ reason: "cancelled" });
  });
  it.each([
    { bytes: new Uint8Array([0xff]), finalUrl: RECENCY_FEED_URL, contentType: "application/xml" },
    { ...response(), contentType: "text/html" },
    { ...response(), bytes: new Uint8Array(SOURCE_RECENCY_FEED_LIMITS.maxBytes + 1) },
    { ...response(), finalUrl: "https://other.example.test/replacement" },
    { ...response(), bytes: new TextEncoder().encode(recencyAtomFeed(recencyAtomEntry("x")).replace(RECENCY_FEED_URL, "https://other.example.test/self")) },
    { ...response(), bytes: new TextEncoder().encode(recencyAtomFeed(recencyAtomEntry("x"))
      .replace('rel="self"', 'rel="http://www.iana.org/assignments/relation/self"').replace(RECENCY_FEED_URL, "https://other.example.test/self")) },
    { ...response(), bytes: new TextEncoder().encode('<rss version="2.0"><channel>') },
    { ...response(), bytes: new TextEncoder().encode(recencyRssFeed(recencyRssItem("old", "Tue, 01 Sep 2026 12:00:00 GMT"))
      .replace('</rss>', `<x:channel xmlns:x="urn:foreign">${recencyRssItem("forged-new")}</x:channel></rss>`)) },
  ])("refuses malformed or mismatched returned document", async returned => {
    transport.mockResolvedValueOnce(returned);
    expect(await createSourceRecencyFeedObserver().observe(scope)).toMatchObject({ reason: "feed-document-unqualified" });
  });
  it("captures source scope before an asynchronous caller mutation", async () => {
    const mutable = { ...scope }, observer = createSourceRecencyFeedObserver();
    const pending = observer.observe(mutable); mutable.sourceId = "other";
    const read = await pending;
    if (read.status !== "observed") throw new Error("fixture read failed");
    expect(read.observation.requestScope.sourceId).toBe(scope.sourceId);
  });
});
