import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { publicReferenceItemId, type PublicReference } from "../public-references/catalog";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { querySqlitePublicReferenceItems, upsertSqlitePublicReference } from "./public-reference-archive";

const connections: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of connections.splice(0)) db.close();
});

function fixture(count = 21) {
  const db = new DatabaseSync(":memory:"); connections.push(db);
  installSqliteApplicationSchema(db, { publicReferenceArchive: true });
  const publishers: PublicReference[] = Array.from({ length: count }, (_, n) => {
    const id = `public:page-${String(n).padStart(3, "0")}`, url = `https://publisher${n}.example/`;
    const items = [0, 1].map(index => {
      const link = `${url}article/${index}`;
      return { id: publicReferenceItemId(id, link), link, title: `Evidence ${n} ${index}`,
        summary: "Retained summary", content: `Original body ${n} ${index}`,
        publishedAt: "2026-11-01T00:00:00.000Z", deliveryKind: "excerpt" as const };
    });
    return { id, name: `Publisher ${n}`, url, rssUrl: url + "feed", description: "Public evidence", tags: [], active: true, items };
  });
  for (const publisher of publishers) upsertSqlitePublicReference(db, publisher);
  return { db, publishers };
}

describe("archive page publisher provenance", () => {
  it.each([1, 20, 100])("retains every original, ordering, total and cursor across publishers at limit %s", limit => {
    const { db } = fixture();
    const complete = querySqlitePublicReferenceItems(db, { limit: 100 });
    const items = [];
    let cursor: string | undefined;
    do {
      const page = querySqlitePublicReferenceItems(db, { limit, cursor });
      expect(page.total).toBe(42);
      expect(page.items.length).toBeLessThanOrEqual(limit);
      items.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    expect(items).toEqual(complete.items);
    expect(new Set(items.map(item => item.referenceId)).size).toBe(21);
    expect(new Set(items.map(item => item.id)).size).toBe(42);
  });

  it.each(["id", "rssUrl", "active", "items", "json"])("refuses a corrupt %s in a later publisher without returning a partial page", field => {
    const { db, publishers } = fixture(3), publisher = publishers[2];
    const value = { ...publisher, ...(field === "id" ? { id: publishers[0].id } : {}),
      ...(field === "rssUrl" ? { rssUrl: "https://different.example/feed" } : {}),
      ...(field === "active" ? { active: false } : {}), ...(field === "items" ? { items: [{ title: "invalid" }] } : {}) };
    db.prepare("UPDATE public_references SET snapshot=? WHERE id=?")
      .run(field === "json" ? "{" : JSON.stringify(value), publisher.id);
    expect(() => querySqlitePublicReferenceItems(db, { limit: 20 })).toThrow();
    expect(db.isTransaction).toBe(false);
  });

  it("refuses a publisher that disappears after page selection", () => {
    const { db, publishers } = fixture(3), prepare = db.prepare.bind(db);
    // Simulate loss of the selected parent between the two reads on this same
    // connection. No partial result may escape, and the failed snapshot rolls back.
    vi.spyOn(db, "prepare").mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql.startsWith("WITH candidate AS")) {
        const all = statement.all.bind(statement);
        vi.spyOn(statement, "all").mockImplementation((...args: Parameters<typeof all>) => {
          const rows = all(...args);
          prepare("DELETE FROM public_reference_articles WHERE reference_id=?").run(publishers[2].id);
          prepare("DELETE FROM public_references WHERE id=?").run(publishers[2].id);
          return rows;
        });
      }
      return statement;
    });
    expect(() => querySqlitePublicReferenceItems(db, { limit: 20 })).toThrow("publisher provenance differs");
    expect(db.isTransaction).toBe(false);
    expect(prepare("SELECT id FROM public_references WHERE id=?").get(publishers[2].id)).toBeDefined();
  });

  it("validates only the returned page, then freshly refuses corrupt lookahead publishers on their page", () => {
    const { db, publishers } = fixture(2);
    db.prepare("UPDATE public_references SET snapshot='{' WHERE id=?").run(publishers[1].id);
    const first = querySqlitePublicReferenceItems(db, { limit: 2 });
    expect(first.total).toBe(4);
    expect(first.items.map(item => item.referenceId)).toEqual([publishers[0].id, publishers[0].id]);
    expect(first.nextCursor).toBeDefined();
    expect(() => querySqlitePublicReferenceItems(db, { limit: 2, cursor: first.nextCursor })).toThrow();
    expect(querySqlitePublicReferenceItems(db, { referenceId: publishers[0].id, query: "unmatched" }))
      .toEqual({ items: [], total: 0 });
  });
});
