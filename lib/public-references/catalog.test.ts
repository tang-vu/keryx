import { sqliteDomainTestFixtures } from "../db/sqlite-domain-test-fixture";
const sqliteFixtures = sqliteDomainTestFixtures();
import { describe, expect, it, vi } from "vitest";
import { publicReferenceSchema, referenceSnapshot, type PublicReference } from "./catalog";
import { importPublicReferenceCatalog } from "./import-catalog";
import { discoverPublicReferences } from "../agent/public-reference-evidence";
import { evidenceContext } from "../llm/evidence-context";
import { SqliteAdapter } from "../db/sqlite-adapter";
import type { Source } from "../types";

const reference: PublicReference = { id: "public:test", name: "Public", url: "https://public.test/",
  rssUrl: "https://public.test/feed", description: "Public feed", tags: ["agents"], active: true, items: [] };
const item = { title: "Agents need evidence", summary: "Agents need evidence", content: "Agents need evidence.",
  link: "https://public.test/post", deliveryKind: "excerpt" as const };
const feed = { feedTitle: "Public", feedDescription: "Public", link: "https://public.test/", items: [item] };

describe("separate public catalog authority", () => {
  it("rejects every payment/ownership field, unsafe rendered links and overlarge snapshots", () => {
    for (const field of ["walletAddress", "authors", "fetchPrice", "verified", "onchainId", "registerTx"])
      expect(publicReferenceSchema.safeParse({ ...reference, [field]: "forged" }).success).toBe(false);
    const snapshot = referenceSnapshot(reference, { ...feed, items: [item, item, { ...item, link: "javascript:alert(1)" },
      { ...item, link: "https://user:password@public.test/post" }] });
    expect(snapshot.items).toHaveLength(1);
    expect(referenceSnapshot(reference, { ...feed, items: Array.from({ length: 30 }, (_, index) => ({ ...item, link: `https://public.test/${index}` })) }).items).toHaveLength(10);
  });

  it("stores public snapshots apart from payable sources and refuses paid-ID collisions", async () => {
    const db = await sqliteFixtures.open(undefined, "testnet-offline");
    try {
      await db.init();
      await db.upsertPublicReference(referenceSnapshot(reference, feed));
      expect(await db.listPublicReferences()).toHaveLength(1);
      expect(await db.getSource(reference.id)).toBeNull();
      expect(await db.listSources()).toEqual([]);
      await expect(db.upsertSource({ id: reference.id } as Source)).rejects.toThrow("Reserved");
    } finally { db.close(); }
  });

  it("imports only the fixed batch, isolates failures and preserves deactivation without resetting upkeep", async () => {
    const stored = new Map<string, PublicReference>();
    const db = { getSource: vi.fn(async () => null), getPublicReference: vi.fn(async (id: string) => stored.get(id) ?? null),
      upsertPublicReference: vi.fn(async (value: PublicReference) => { stored.set(value.id, value); }) };
    const ingest = vi.fn(async (url: string) => { if (url.includes("huyenchip")) throw new Error("Unavailable"); return feed; });
    const result = await importPublicReferenceCatalog(db, ingest);
    expect(result).toHaveLength(4);
    expect(result.filter((entry) => entry.ok)).toHaveLength(3);
    expect(ingest).toHaveBeenCalledTimes(4);
    const cloudflare = stored.get("public:cloudflare-workers")!;
    stored.set(cloudflare.id, { ...cloudflare, active: false });
    await importPublicReferenceCatalog(db, ingest);
    expect(stored.get(cloudflare.id)?.active).toBe(false);
    expect(stored.size).toBe(3);
  });

  it("binds immutable public evidence to selected body/link/date while using existing bounded context", async () => {
    const snapshot = referenceSnapshot(reference, { ...feed, items: [{ ...item, content: "Agents need evidence. ".repeat(15_000), publishedAt: "2025-01-16T00:00:00.000Z" }] });
    const { publicReads } = await discoverPublicReferences({ listPublicReferences: async () => [snapshot] }, "What evidence do agents need?", ["Agents need evidence"]);
    const read = publicReads.get(reference.id)!;
    const originalVersion = read.contentVersion;
    snapshot.items[0]!.content = "Changed after discovery";
    expect(read.text).not.toContain("Changed after discovery");
    expect(read.contentVersion).toBe(originalVersion);
    expect(read.itemPublishedAt).toBe("2025-01-16T00:00:00.000Z");
    expect(read.contentReceipt).toBeUndefined();
    const context = evidenceContext("What evidence do agents need?", ["Agents need evidence"], [read])[0]!;
    expect(context.scannedCharacters).toBeLessThanOrEqual(200_000);
    expect(context.passages.reduce((total, passage) => total + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    expect(context.sourceKind).toBe("public-reference");
  });
});
