import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { iterateSupabaseRecentQueries } from "./recent-query-stream";

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const rows: T[] = []; for await (const row of stream) rows.push(row); return rows;
}
const time = "2026-09-01T00:00:00.000Z";
const row = (id: string) => ({ id, created_at: time, data: { id } });

describe("Supabase recent query scan", () => {
  it("uses ordered bounded keyset requests even when the server caps pages", async () => {
    const ids = ["z", "y", "x", "w"];
    const requests: URL[] = [];
    const db = createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async (input, init) => {
      expect(init?.signal).toBeDefined();
      const url = new URL(String(input)); requests.push(url);
      expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc");
      expect(url.searchParams.get("select")).toBe("id,created_at,data");
      const filter = url.searchParams.get("or");
      let eligible = ids;
      if (filter) {
        const match = filter.match(/id\.lt\."([a-z])"/);
        expect(match).not.toBeNull();
        expect(filter).toBe(`(created_at.lt."${time}",and(created_at.eq."${time}",id.lt."${match![1]}"))`);
        eligible = ids.filter(id => id < match![1]);
      }
      const selected = eligible.slice(0, Math.min(2, Number(url.searchParams.get("limit"))));
      if (requests.length === 1) ids.unshift("zz"); // New head must not shift the next page.
      return Response.json(selected.map(row));
    } } });
    expect((await collect(iterateSupabaseRecentQueries(db, 10))).map(r => r.id)).toEqual(["z", "y", "x", "w"]);
    expect(requests).toHaveLength(3);
    expect(requests.every(url => Number(url.searchParams.get("limit")) <= 32)).toBe(true);
  });

  it("escapes reserved cursor characters through the actual HTTP builder", async () => {
    const id = 'x,"\\()'; let calls = 0;
    const db = createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async input => {
      if (++calls === 1) return Response.json([row(id)]);
      expect(new URL(String(input)).searchParams.get("or")).toBe(`(created_at.lt."${time}",and(created_at.eq."${time}",id.lt."x,\\"\\\\()"))`);
      return Response.json([]);
    } } });
    expect(await collect(iterateSupabaseRecentQueries(db, 2))).toHaveLength(1);
  });

  it.each(["error", "duplicate", "mismatch", "timestamp", "control"])("rejects %s without returning a complete scan", async kind => {
    let calls = 0;
    const db = createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async () => {
      if (++calls === 1) return Response.json([row("z")]);
      if (kind === "error") return Response.json({ message: "Unavailable" }, { status: 503 });
      const bad = kind === "duplicate" ? row("z") : kind === "mismatch" ? { ...row("y"), data: { id: "other" } }
        : kind === "timestamp" ? { ...row("y"), created_at: "bad" } : row("bad\n");
      return Response.json([bad]);
    } } });
    await expect(collect(iterateSupabaseRecentQueries(db, 3))).rejects.toThrow("Query scan");
  });

  it.each([0, -1, 2501, 1.5, NaN])("rejects invalid limit %s before access", async limit => {
    const db = createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async () => { throw new Error("Must not fetch"); } } });
    await expect(collect(iterateSupabaseRecentQueries(db, limit))).rejects.toThrow("Invalid query scan limit");
  });
});
