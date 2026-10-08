import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import type { SourceItem } from "../types";

it("binds exact source/link catalog membership and refuses duplicate rows without an older fallback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "keryx-catalog-membership-")), db = new SqliteAdapter(join(directory, "fixture.sqlite"));
  try {
    await db.init();
    for (const id of ["one", "other"]) await db.upsertSource({ id, name: id, url: `https://${id}.example`, description: "Synthetic",
      walletAddress: "0x0000000000000000000000000000000000000001", fetchPrice: 0.001, tags: [], authors: [], createdAt: "2026-10-08T00:00:00.000Z" });
    const item: SourceItem = { id: "first", sourceId: "one", title: "Observed catalog body", summary: "Synthetic preview",
      content: "The catalog body stays authoritative.", link: "https://one.example/newest", publishedAt: "2026-10-08T00:00:00.000Z", bodyHash: "0x" + "ab".repeat(32) };
    await db.addItems([item, { ...item, id: "foreign", sourceId: "other" }, { ...item, id: "old", link: "https://one.example/older" }]);
    expect(await db.getSourceItemByLink("one", item.link)).toMatchObject(item);
    expect(await db.getSourceItemByLink("one", item.link + "/")).toBeNull();
    expect(await db.getSourceItemByLink("missing-source", item.link)).toBeNull();
    await db.addItems([{ ...item, id: "duplicate" }]);
    await expect(db.getSourceItemByLink("one", item.link)).rejects.toThrow("Ambiguous exact source article membership");
    expect((await db.getSourceItemByLink("one", "https://one.example/older"))?.id).toBe("old");
  } finally { db.close(); rmSync(directory, { recursive: true }); }
});
