import { describe, expect, it } from "vitest";
import {
  MAX_SOURCE_PAGE_SIZE,
  decodeSourceCursor,
  encodeSourceCursor,
  paginateSourceList,
} from "./paginate-source-list";

function row(id: string, createdAt: string) {
  return { id, createdAt };
}

const rows = [
  row("c", "2026-07-01T00:00:00.000Z"),
  row("a", "2026-07-02T00:00:00.000Z"),
  // Same-second pair, listed out of id order on purpose — bulk import produces these.
  row("e", "2026-07-03T00:00:00.000Z"),
  row("d", "2026-07-03T00:00:00.000Z"),
  row("b", "2026-07-04T00:00:00.000Z"),
];

describe("paginateSourceList", () => {
  it("returns the first page in (createdAt, id) order with a cursor when more remain", () => {
    const page = paginateSourceList(rows, { limit: 2 });
    expect(page.items.map((r) => r.id)).toEqual(["c", "a"]);
    expect(page.nextCursor).toBeDefined();
  });

  it("walks every row exactly once across pages, breaking created_at ties by id", () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let hops = 0; hops < 10; hops++) {
      const page = paginateSourceList(rows, { limit: 2, cursor });
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["c", "a", "d", "e", "b"]);
  });

  it("omits nextCursor on the exact last page", () => {
    const first = paginateSourceList(rows, { limit: 3 });
    const second = paginateSourceList(rows, { limit: 3, cursor: first.nextCursor });
    expect(second.items.map((r) => r.id)).toEqual(["e", "b"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("survives a row disappearing between pages (cursor is a position, not a reference)", () => {
    const first = paginateSourceList(rows, { limit: 2 });
    // "d" deactivates between requests.
    const remaining = rows.filter((r) => r.id !== "d");
    const second = paginateSourceList(remaining, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((r) => r.id)).toEqual(["e", "b"]);
  });

  it("returns an empty final page for a cursor past the end", () => {
    const cursor = encodeSourceCursor(row("z", "2027-01-01T00:00:00.000Z"));
    const page = paginateSourceList(rows, { limit: 2, cursor });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it("clamps the limit to MAX_SOURCE_PAGE_SIZE and to at least 1", () => {
    const big = paginateSourceList(rows, { limit: 10_000 });
    expect(big.items).toHaveLength(rows.length); // 5 < MAX, so clamp changes nothing here
    expect(MAX_SOURCE_PAGE_SIZE).toBe(100);
    const tiny = paginateSourceList(rows, { limit: 0 });
    expect(tiny.items).toHaveLength(1);
  });

  it("throws on a malformed cursor so the route can 400", () => {
    expect(() => paginateSourceList(rows, { limit: 2, cursor: "not-a-cursor" })).toThrow();
    const wrongShape = Buffer.from(JSON.stringify({ id: "a" }), "utf8").toString("base64url");
    expect(() => decodeSourceCursor(wrongShape)).toThrow();
  });

  it("round-trips a cursor", () => {
    const cursor = encodeSourceCursor(row("abc", "2026-07-16T04:00:00.000Z"));
    expect(decodeSourceCursor(cursor)).toEqual({ id: "abc", createdAt: "2026-07-16T04:00:00.000Z" });
  });
});
