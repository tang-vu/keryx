/**
 * Refresh must be idempotent per link (a feed re-serves its whole window every fetch), must
 * never write anything when the feed is unreachable, and the sweep must only crawl feeds
 * whose owner has proven control — those are the invariants pinned here.
 */

import { describe, it, expect } from "vitest";
import { refreshSourceFeed, refreshAllFeeds, type RefreshDb } from "./refresh-feed";
import type { IngestedFeed } from "./rss";
import type { Source, SourceItem } from "@/lib/types";

function fakeDb(initial: SourceItem[] = []) {
  const items = [...initial];
  const db: RefreshDb = {
    getItems: async (sid) => items.filter((i) => i.sourceId === sid),
    addItems: async (batch) => {
      items.push(...batch);
    },
  };
  return { db, items };
}

const feedItem = (link: string, title = "post") => ({
  title,
  summary: "s",
  content: "c",
  link,
});

const feedOf = (...links: string[]): IngestedFeed => ({
  feedTitle: "t",
  feedDescription: "d",
  link: "https://blog.example",
  items: links.map((l) => feedItem(l)),
});

const SRC = { id: "src-1", name: "Blog", rssUrl: "https://blog.example/rss.xml" };

describe("refreshSourceFeed", () => {
  it("adds only posts the DB has never seen, keyed by link", async () => {
    const { db, items } = fakeDb([
      { id: "a", sourceId: "src-1", title: "old", summary: "s", content: "c", link: "https://blog.example/1" },
    ]);
    const out = await refreshSourceFeed(db, SRC, async () =>
      feedOf("https://blog.example/1", "https://blog.example/2"),
    );
    expect(out).toMatchObject({ added: 1, total: 2 });
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ sourceId: "src-1", link: "https://blog.example/2" });
    expect(items[1]!.id).toBeTruthy();
  });

  it("is idempotent — a second pass over the same feed adds nothing", async () => {
    const { db, items } = fakeDb();
    const ingest = async () => feedOf("https://blog.example/1");
    await refreshSourceFeed(db, SRC, ingest);
    const second = await refreshSourceFeed(db, SRC, ingest);
    expect(second).toMatchObject({ added: 0, total: 1 });
    expect(items).toHaveLength(1);
  });

  it("skips link-less items — they cannot be deduped on the next pass", async () => {
    const { db, items } = fakeDb();
    const out = await refreshSourceFeed(db, SRC, async () => feedOf(""));
    expect(out.added).toBe(0);
    expect(items).toHaveLength(0);
  });

  it("reports an unreachable feed as { error } and writes nothing", async () => {
    const { db, items } = fakeDb();
    const out = await refreshSourceFeed(db, SRC, async () => {
      throw new Error("ETIMEDOUT");
    });
    expect(out.error).toBe("ETIMEDOUT");
    expect(out.added).toBe(0);
    expect(items).toHaveLength(0);
  });

  it("writes nothing when the encrypted-storage boundary rejects the new batch", async () => {
    const { db, items } = fakeDb();
    const out = await refreshSourceFeed(
      db,
      SRC,
      async () => feedOf("https://blog.example/2"),
      async () => {
        throw new Error("Pinata unavailable");
      },
    );
    expect(out).toMatchObject({ added: 0, total: 0 });
    expect(out.error).toContain("content storage failed: Pinata unavailable");
    expect(items).toHaveLength(0);
  });

  it("includes the transport cause below Undici's generic fetch failure", async () => {
    const { db } = fakeDb();
    const out = await refreshSourceFeed(db, SRC, async () => {
      throw new Error("fetch failed", { cause: new Error("connect ETIMEDOUT") });
    });
    expect(out.error).toBe("fetch failed: connect ETIMEDOUT");
  });

  it("reports a feed-less source as { error } without ingesting", async () => {
    const { db } = fakeDb();
    const out = await refreshSourceFeed(db, { id: "x", name: "Manual" }, async () => {
      throw new Error("must not be called");
    });
    expect(out.error).toBe("source has no feed");
  });
});

describe("refreshAllFeeds", () => {
  it("sweeps only verified sources that have a feed", async () => {
    const { db } = fakeDb();
    const src = (over: Partial<Source>): Source => ({
      id: "s",
      name: "n",
      url: "",
      description: "",
      walletAddress: "0x0",
      fetchPrice: 0.001,
      tags: [],
      authors: [],
      createdAt: "",
      rssUrl: "https://blog.example/rss.xml",
      ...over,
    });
    const crawled: string[] = [];
    const results = await refreshAllFeeds(
      {
        ...db,
        listSources: async () => [
          src({ id: "ok" }),
          src({ id: "unverified", verified: false }),
          src({ id: "manual", rssUrl: undefined }),
        ],
      },
      async (url) => {
        crawled.push(url);
        return feedOf("https://blog.example/1");
      },
    );
    expect(results.map((r) => r.sourceId)).toEqual(["ok"]);
    expect(crawled).toHaveLength(1);
  });
});
