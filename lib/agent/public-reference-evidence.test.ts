import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { discoverPublicReferences } from "./public-reference-evidence";
import { referenceSnapshot, type PublicReference } from "../public-references/catalog";
import type { PublicReferenceArticle } from "../public-references/archive";
const reference: PublicReference = { id: "public:test", name: "Publisher", url: "https://publisher.test/", rssUrl: "https://publisher.test/feed",
  description: "Engineering articles", tags: ["database"], active: true, items: [] };
const snapshot = (title: string, content: string, link: string) => referenceSnapshot(reference,
  { feedTitle: "Publisher", feedDescription: "", link: reference.url, items: [{ title, summary: content, content, link, deliveryKind: "excerpt", publishedAt: "2020-01-01T00:00:00.000Z" }] });
function archived(value: PublicReference): PublicReferenceArticle {
  return { ...value.items[0], referenceId: reference.id, collectionKind: "feed", firstCollectedAt: "2026-10-12T00:00:00.000Z",
    lastCollectedAt: "2026-10-12T00:00:00.000Z", contentVersion: "sha256:fixture" };
}
describe("historical public article discovery", () => {
  it("finds old articles outside recent feed previews and proposes distinct articles for different targets", async () => {
    const history = [archived(snapshot("SQLite backups", "SQLite backups preserve consistent snapshots.", "https://publisher.test/old-backup")),
      archived(snapshot("Postgres replication", "Postgres replication copies the WAL stream.", "https://publisher.test/old-replication"))];
    const recent = snapshot("New release", "New release news unrelated to backup or replication.", "https://publisher.test/new");
    const result = await discoverPublicReferences({ listPublicReferences: async () => [recent],
      queryPublicReferenceItems: async () => ({ items: history, total: history.length }) },
    "Compare SQLite backups and Postgres replication", ["SQLite backups", "Postgres replication"], null);
    expect(new Set([...result.publicReads.values()].map(read => read.itemUrl))).toEqual(new Set(history.map(item => item.link)));
    expect(result.publicCandidates.size).toBe(2);
    expect(new Set([...result.publicCandidates.keys()]).size).toBe(2);
    for (const read of result.publicReads.values()) {
      expect(read.sourceId).toBe(reference.id);
      expect(read.sourceKind).toBe("public-reference");
      expect(read.contentReceipt).toBeUndefined();
    }
    history[0].content = "Updated after discovery";
    expect([...result.publicReads.values()].some(read => read.text.includes("Updated after discovery"))).toBe(false);
  });
  it("keeps classified unavailable search and independent previews through an archive failure", async () => {
    const recent = snapshot("SQLite backup", "SQLite backup text.", "https://publisher.test/new");
    const result = await discoverPublicReferences({ listPublicReferences: async () => [recent],
      queryPublicReferenceItems: async () => { throw new Error("Archive unavailable"); } }, "SQLite backup", ["SQLite backup"], null);
    expect(result.archiveSearch.status).toBe("unavailable");
    expect(result.publicReads.get(reference.id)?.text).toBe("SQLite backup text.");
  });
  it("uses the retained original body when a current feed shrinks the same article to a preview", async () => {
    const recent = snapshot("SQLite backups", "SQLite backup preview.", "https://publisher.test/same");
    const original = archived(snapshot("SQLite backups", "SQLite backup original explains consistent database snapshots and checkpoint behavior.", "https://publisher.test/same"));
    original.collectionKind = "article";
    const result = await discoverPublicReferences({ listPublicReferences: async () => [recent],
      queryPublicReferenceItems: async () => ({ items: [original], total: 1 }) }, "SQLite backups", ["SQLite backups"], null);
    expect(result.publicReads.get(reference.id)?.text).toBe(original.content);
    expect(result.publicReads.get(reference.id)?.text).not.toBe(recent.items[0].content);
  });
  it("admits a body-only historical match without rewriting its captured identity", async () => {
    const recent = snapshot("Latest news", "A new unrelated announcement.", "https://publisher.test/new");
    const original = archived(snapshot("Engineering notes", "A generic opening. ".repeat(80) + "SQLite backups require a consistent snapshot.", "https://publisher.test/old"));
    original.summary = "Generic engineering notes.";
    const result = await discoverPublicReferences({ listPublicReferences: async () => [recent],
      queryPublicReferenceItems: async () => ({ items: [original], total: 1 }) }, "SQLite backups", ["SQLite backups"], null);
    const read = result.publicReads.get(reference.id)!;
    expect(read.itemUrl).toBe(original.link);
    expect(result.publicCandidates.get(reference.id)?.preview).toContain("SQLite backups");
    expect(read.text).toBe(original.content);
  });
  it("replaces a legacy raw-URL preview with the same canonical article's richer archived body", async () => {
    const raw = "https://publisher.test/same?utm_source=feed";
    const recent = snapshot("SQLite backups", "SQLite backup preview.", raw);
    recent.items[0].id = `public-item:${createHash("sha256").update(`${reference.id}\n${raw}`).digest("hex")}`;
    const original = archived(snapshot("SQLite backups", "SQLite backup original includes WAL and transaction consistency.", "https://publisher.test/same"));
    const result = await discoverPublicReferences({ listPublicReferences: async () => [recent],
      queryPublicReferenceItems: async () => ({ items: [original], total: 1 }) }, "SQLite backups", ["SQLite backups"], null);
    expect(result.publicReads.size).toBe(1);
    expect(result.publicReads.get(reference.id)?.itemId).toBe(original.id);
    expect(result.publicReads.get(reference.id)?.text).toBe(original.content);
  });
  it("never re-admits an inactive publisher or replaces a newest requirement with old matching articles", async () => {
    const recent = snapshot("SQLite backup", "SQLite backup text.", "https://publisher.test/new");
    const result = await discoverPublicReferences({ listPublicReferences: async () => [{ ...recent, active: false }],
      queryPublicReferenceItems: async () => ({ items: [archived(recent)], total: 1 }) }, "SQLite backup", ["SQLite backup"], null);
    expect(result.publicReads.size).toBe(0);
  });
});
