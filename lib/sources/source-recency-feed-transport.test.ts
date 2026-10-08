import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: transport.lookup }));
vi.mock("undici", () => ({ fetch: transport.fetch, Agent: class { async close() {} } }));

import { createSourceRecencyFeedObserver } from "./source-recency-feed";
import { RECENCY_FEED_URL, recencyAtomEntry, recencyAtomFeed } from "./source-recency-feed-fixtures";

const scope = { scope: "current-feed" as const, sourceId: "creator-source", feedUrl: RECENCY_FEED_URL };
const xml = recencyAtomFeed(recencyAtomEntry("new", "2026-09-01T12:00:00Z"));
beforeEach(() => {
  transport.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  transport.fetch.mockReset();
});

describe("feed observer through the actual bounded public reader", () => {
  it("accepts a complete 200 XML response with no secondary transport", async () => {
    transport.fetch.mockResolvedValueOnce(new Response(xml, { status: 200, headers: { "content-type": "application/atom+xml" } }));
    const read = await createSourceRecencyFeedObserver().observe(scope);
    expect(read.status).toBe("observed");
    expect(transport.lookup).toHaveBeenCalledOnce();
    expect(transport.fetch).toHaveBeenCalledOnce();
  });
  it.each([
    { status: 206, headers: {} },
    { status: 200, headers: { "content-range": "bytes 0-199/900" } },
    { status: 200, headers: { "content-range": "" } },
  ])("refuses known partial response even when its XML is well formed: $status $headers", async ({ status, headers }) => {
    const responseHeaders = new Headers({ "content-type": "application/atom+xml" });
    for (const [name, value] of Object.entries(headers)) if (value !== undefined) responseHeaders.set(name, value);
    transport.fetch.mockResolvedValueOnce(new Response(xml, { status, headers: responseHeaders }));
    const observer = createSourceRecencyFeedObserver(), read = await observer.observe(scope);
    expect(read).toMatchObject({ status: "withheld", reason: "feed-read-failed" });
    expect(read).not.toHaveProperty("observation");
    expect(observer.readsUsed).toBe(1);
  });
  it("refuses any private DNS answer before HTTP even when another answer is public", async () => {
    transport.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    expect(await createSourceRecencyFeedObserver().observe(scope)).toMatchObject({ status: "withheld", reason: "feed-read-failed" });
    expect(transport.fetch).not.toHaveBeenCalled();
  });
  it("refuses redirects without fetching a replacement feed", async () => {
    transport.fetch.mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://other.example.test/replacement" } }));
    expect(await createSourceRecencyFeedObserver().observe(scope)).toMatchObject({ status: "withheld", reason: "feed-read-failed" });
    expect(transport.fetch).toHaveBeenCalledOnce(); expect(transport.lookup).toHaveBeenCalledOnce();
  });
});
