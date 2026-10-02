import { afterEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter } from "./supabase-adapter";
import { createClient } from "@supabase/supabase-js";
import type { Source } from "../types";

vi.mock("@supabase/supabase-js", async original => ({ ...await original<typeof import("@supabase/supabase-js")>(), createClient: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const wallet = "0x" + "aB".repeat(20);
const source: Source = { id: "proof", name: "Publication", url: "https://feed.test", rssUrl: "https://feed.test/rss", description: "Observed source",
  walletAddress: wallet, fetchPrice: 0.003, tags: [], authors: [{ name: "Owner", walletAddress: wallet, splitWeight: 1 }],
  createdAt: "2026-10-02", verified: false, active: true };

it("SQLite verifies only an unchanged payout/feed and preserves newer pricing/authors/activity", async () => {
  const db = new SqliteAdapter(":memory:");
  try {
    await db.init(); await db.upsertSource(source);
    const original = { sourceId: source.id, walletAddress: wallet.toLowerCase(), feedUrl: source.rssUrl! };
    const current = { ...source, fetchPrice: 0.019, active: false, description: "Concurrent metadata", authors: [{ ...source.authors[0], name: "Current owner" }] };
    await db.upsertSource(current);
    expect(await db.verifySourceIfUnchanged(original)).toBe(true);
    expect(await db.getSource(source.id)).toMatchObject({ ...current, verified: true });
    await db.upsertSource({ ...current, walletAddress: "0x1111111111111111111111111111111111111111", verified: false });
    expect(await db.verifySourceIfUnchanged(original)).toBe(false);
    expect((await db.getSource(source.id))?.verified).toBe(false);
    await db.upsertSource({ ...current, rssUrl: "https://changed.test/rss", verified: false });
    expect(await db.verifySourceIfUnchanged(original)).toBe(false);
    expect(await db.verifySourceIfUnchanged({ ...original, sourceId: "deleted" })).toBe(false);
  } finally { db.close(); }
});

it("SQLite binds exact effective home URL only when persisted feed is empty", async () => {
  const db = new SqliteAdapter(":memory:");
  try {
    await db.init(); await db.upsertSource({ ...source, rssUrl: "" });
    expect(await db.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet, feedUrl: source.url + "/" })).toBe(false);
    expect(await db.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet, feedUrl: source.url })).toBe(true);
  } finally { db.close(); }
});

it("Supabase sends one guarded CAS RPC with exact feed and lowercase observed wallet", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-authority");
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null }), from = vi.fn();
  vi.mocked(createClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof createClient>);
  const db = new SupabaseAdapter();
  expect(await db.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet, feedUrl: source.rssUrl! })).toBe(true);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("verify_source_if_unchanged", { p_source_id: source.id, p_wallet_address: wallet.toLowerCase(), p_feed_url: source.rssUrl });
  expect(from).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: false, error: null });
  expect(await db.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet, feedUrl: source.rssUrl! })).toBe(false);
  rpc.mockResolvedValue({ data: null, error: new Error("write failed") });
  await expect(db.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet, feedUrl: source.rssUrl! })).rejects.toThrow("unavailable");
});
