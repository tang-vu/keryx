import { testSupabaseAuthority } from "./supabase-authority-test-fixture";
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
    const requests: { p_limit: number; p_before_time: string | null; p_before_id: string | null }[] = [];
    const db = await testSupabaseAuthority(createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async (input, init) => {
      expect(init?.signal).toBeDefined();
      expect(new URL(String(input)).pathname).toBe("/rest/v1/rpc/storage_iterate_recent_queries");
      const body = JSON.parse(String(init?.body)); requests.push(body);
      const filter = body.p_before_id;
      let eligible = ids;
      if (filter) {
        expect(body.p_before_time).toBe(time);
        eligible = ids.filter(id => id < filter);
      }
      const selected = eligible.slice(0, Math.min(2, body.p_limit));
      if (requests.length === 1) ids.unshift("zz"); // New head must not shift the next page.
      return Response.json(selected.map(row));
    } } }));
    expect((await collect(iterateSupabaseRecentQueries(db, 10))).map(r => r.id)).toEqual(["z", "y", "x", "w"]);
    expect(requests).toHaveLength(3);
    expect(requests.every(body => body.p_limit <= 32)).toBe(true);
  });

  it("sends reserved cursor characters as typed JSON without filter interpolation", async () => {
    const id = 'x,"\\()'; let calls = 0;
    const db = await testSupabaseAuthority(createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async (input, init) => {
      if (++calls === 1) return Response.json([row(id)]);
      expect(new URL(String(input)).pathname).toBe("/rest/v1/rpc/storage_iterate_recent_queries");
      expect(JSON.parse(String(init?.body))).toMatchObject({ p_before_time: time, p_before_id: id });
      return Response.json([]);
    } } }));
    expect(await collect(iterateSupabaseRecentQueries(db, 2))).toHaveLength(1);
  });

  it.each(["error", "duplicate", "mismatch", "timestamp", "control"])("rejects %s without returning a complete scan", async kind => {
    let calls = 0;
    const db = await testSupabaseAuthority(createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async () => {
      if (++calls === 1) return Response.json([row("z")]);
      if (kind === "error") return Response.json({ message: "Unavailable" }, { status: 503 });
      const bad = kind === "duplicate" ? row("z") : kind === "mismatch" ? { ...row("y"), data: { id: "other" } }
        : kind === "timestamp" ? { ...row("y"), created_at: "bad" } : row("bad\n");
      return Response.json([bad]);
    } } }));
    await expect(collect(iterateSupabaseRecentQueries(db, 3))).rejects.toThrow("Query scan");
  });

  it.each([0, -1, 2501, 1.5, NaN])("rejects invalid limit %s before access", async limit => {
    const db = await testSupabaseAuthority(createClient("https://fixture.invalid", "fixture-key", { global: { fetch: async () => { throw new Error("Must not fetch"); } } }));
    await expect(collect(iterateSupabaseRecentQueries(db, limit))).rejects.toThrow("Invalid query scan limit");
  });
});
