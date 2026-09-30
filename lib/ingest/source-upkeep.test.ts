import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import type { Source, SourceItem } from "../types";
import { handleSourceUpkeep, runSourceUpkeep } from "./source-upkeep";
import type { IngestedFeed } from "./rss";

const token = "a".repeat(43);
const source = { id: "one", name: "Publisher", active: true, verified: true,
  rssUrl: "https://publisher.test/rss" } as Source;
const feed: IngestedFeed = { feedTitle: "f", feedDescription: "d", link: "https://publisher.test",
  items: [{ title: "Paid", summary: "Preview", content: "Private article plaintext", link: "https://publisher.test/post" }] };
function setup() {
  const stored: SourceItem[] = [];
  const db = {
    claimSourceUpkeep: vi.fn(async () => ({ slot: 1, sourceIds: ["one"] })),
    finishSourceUpkeep: vi.fn(async () => {}),
    getSource: vi.fn(async () => ({ ...source })),
    getItems: vi.fn(async () => []),
    setCached: vi.fn(async () => {}),
    addItems: vi.fn(async (items: SourceItem[]) => { stored.push(...items); }),
  };
  return { db, stored };
}
afterEach(() => vi.unstubAllEnvs());

describe("source upkeep boundary", () => {
  it("authenticates before DB initialization and refuses methods, URLs and bodies", async () => {
    const get = vi.fn(async () => setup().db);
    expect((await handleSourceUpkeep(new Request("https://keryx.cc/api/internal/source-upkeep", { method: "POST" }), token, get)).status).toBe(401);
    expect(get).not.toHaveBeenCalled();
    for (const [method, query, body, status] of [
      ["GET", "", undefined, 405], ["POST", "?url=https://evil.test", undefined, 400],
      ["POST", "", "{}", 400],
    ] as const) {
      const request = new Request(`https://keryx.cc/api/internal/source-upkeep${query}`, {
        method, body, headers: { authorization: `Bearer ${token}` },
      });
      expect((await handleSourceUpkeep(request, token, get)).status).toBe(status);
    }
    expect(get).not.toHaveBeenCalled();
    expect((await handleSourceUpkeep(new Request("https://keryx.cc", { method: "POST", headers: { authorization: `Bearer ${token}` } }), undefined, get)).status).toBe(401);
  });

  it("keeps all new content encrypted locally, dedupes repeated feed links and returns counts only", async () => {
    vi.stubEnv("CONTENT_MASTER_KEY", "67".repeat(32));
    vi.stubEnv("PINATA_JWT", "would-have-pinned");
    const { db, stored } = setup();
    const result = await runSourceUpkeep(db, { ingest: async () => ({ ...feed, items: [...feed.items, ...feed.items] }) });
    expect(result.summary).toEqual({ attempted: 1, added: 1, failed: 0, skipped: 0 });
    expect(stored).toHaveLength(1);
    expect(stored[0].storageMode).toBe("db_encrypted");
    expect(stored[0].content).not.toContain("plaintext");
    expect(stored[0].itemKeyEnc).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("publisher");
    expect(JSON.stringify(result)).not.toContain("Private");
  });

  it("accepts an empty streamed Node POST and refuses one-byte or stalled streamed input", async () => {
    const empty = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const oneByte = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); } });
    const stalled = new ReadableStream<Uint8Array>();
    const { db } = setup();
    db.claimSourceUpkeep.mockResolvedValue(null as never);
    const get = vi.fn(async () => db);
    for (const [body, status] of [[empty, 200], [oneByte, 400], [stalled, 400]] as const) {
      const request = new Request("https://keryx.cc", {
        method: "POST", body, headers: { authorization: `Bearer ${token}` },
        duplex: "half",
      } as RequestInit);
      expect((await handleSourceUpkeep(request, token, get)).status).toBe(status);
    }
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("refuses missing encryption keys and isolates feed failures without leaking causes", async () => {
    vi.stubEnv("CONTENT_MASTER_KEY", "");
    const { db, stored } = setup();
    expect((await runSourceUpkeep(db, { ingest: async () => feed })).summary?.failed).toBe(1);
    expect(stored).toHaveLength(0);
    const failure = await runSourceUpkeep(db, { ingest: async () => { throw new Error("https://secret.test PRIVATE CONTENT"); } });
    expect(failure.summary?.failed).toBe(1);
    expect(JSON.stringify(failure)).not.toContain("secret");
  });

  it.each(["deactivated", "unverified", "changed feed"])("rechecks %s before encrypting/writing", async (change) => {
    vi.stubEnv("CONTENT_MASTER_KEY", "67".repeat(32));
    const { db, stored } = setup();
    const ingest = async () => {
      db.getSource.mockResolvedValue({ ...source,
        ...(change === "deactivated" ? { active: false } : change === "unverified" ? { verified: false } : { rssUrl: "https://changed.test" }),
      });
      return feed;
    };
    expect((await runSourceUpkeep(db, { ingest })).summary?.failed).toBe(1);
    expect(stored).toHaveLength(0);
    expect(db.setCached).not.toHaveBeenCalled();
  });

  it("a delayed fetch cannot write after the timed-out job returns", async () => {
    vi.stubEnv("CONTENT_MASTER_KEY", "67".repeat(32));
    const { db, stored } = setup();
    let complete!: (feed: IngestedFeed) => void;
    const result = await runSourceUpkeep(db, { jobMs: 5, ingest: () => new Promise((resolve) => { complete = resolve; }) });
    expect(result.summary?.failed).toBe(1);
    complete(feed);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stored).toHaveLength(0);
    expect(db.setCached).not.toHaveBeenCalled();
    expect(db.finishSourceUpkeep).toHaveBeenCalledTimes(1);
  });

  it("fails closed for an adapter without atomic upkeep admission", async () => {
    const get = async () => ({}) as KeryxDB;
    const response = await handleSourceUpkeep(new Request("https://keryx.cc", {
      method: "POST", headers: { authorization: `Bearer ${token}` },
    }), token, get);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Source upkeep unavailable" });
  });
});
