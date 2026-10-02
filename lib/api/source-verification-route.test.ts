import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), check: vi.fn(), write: vi.fn(), activation: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/lib/db", () => ({ getDb: m.db }));
vi.mock("@/lib/activation", () => ({ recordActivationEvent: m.activation }));
vi.mock("@/lib/sources/feed-verification", () => ({ checkFeedToken: m.check, verificationToken: (wallet: string) => `keryx-verify:${wallet.toLowerCase()}` }));
import { GET, POST } from "@/app/api/sources/verify/route";
import { GET as ownedSources } from "@/app/api/me/sources/route";
const payout = `0x${"a".repeat(40)}`, author = `0x${"b".repeat(40)}`;
const source = { id: "persisted-source", walletAddress: payout, rssUrl: "https://feed.example/rss", verified: false, name: "Existing source", authors: [{ walletAddress: author, share: 1 }] };
const url = "https://test.example/api/sources/verify";
const post = () => POST(new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: source.id }) }));
const get = () => GET(new NextRequest(`${url}?sourceId=${source.id}`));
function database(value: typeof source | null = source) { return { getSource: async () => value, upsertSource: m.write, listAllSources: async () => value ? [value] : [], creatorLeaderboard: async () => [], getSourceNotifyEmail: async () => null, getSourceNotify: async () => null }; }
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue({ address: payout.toUpperCase() }); m.db.mockResolvedValue(database()); m.check.mockResolvedValue("present"); });
it("lets a returning payout owner inspect persisted instructions and verify the existing ID only", async () => {
  expect(await (await get()).json()).toEqual({ source: { id: source.id, walletAddress: payout, rssUrl: source.rssUrl, verified: false } });
  const response = await post(); expect(await response.json()).toEqual({ verified: true });
  expect(m.check).toHaveBeenCalledWith(source.rssUrl, payout);
  expect(m.write).toHaveBeenCalledOnce(); expect(m.write).toHaveBeenCalledWith({ ...source, verified: true });
});
it.each([author, `0x${"c".repeat(40)}`])("rejects another recipient or unrelated wallet %s before feed access", async address => {
  m.session.mockResolvedValue({ address }); expect((await get()).status).toBe(403); expect((await post()).status).toBe(403);
  expect(m.check).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled();
});
it("keeps already-verified requests idempotent", async () => {
  m.db.mockResolvedValue(database({ ...source, verified: true })); expect(await (await post()).json()).toEqual({ verified: true, alreadyVerified: true });
  expect(m.check).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled(); expect(m.activation).not.toHaveBeenCalled();
});
it("reports missing tokens and feed failures distinctly without mutating state", async () => {
  m.check.mockResolvedValueOnce("missing"); const missing = await post(); expect(missing.status).toBe(200); expect(await missing.json()).toMatchObject({ verified: false, code: "token_not_found" });
  m.check.mockResolvedValueOnce("unavailable"); const failed = await post(); expect(failed.status).toBe(502); expect(await failed.json()).toMatchObject({ verified: false, code: "feed_unavailable" }); expect(m.write).not.toHaveBeenCalled();
});
it("never treats a missing index row or anonymous request as verified", async () => {
  m.db.mockResolvedValue(database(null)); expect((await get()).status).toBe(404); expect((await post()).status).toBe(404); expect(m.check).not.toHaveBeenCalled();
  m.session.mockResolvedValue(null); expect((await get()).status).toBe(401); expect((await post()).status).toBe(401);
});
it("rechecks the persisted payout identity and exposes portfolio verification only to that owner", async () => {
  expect(await (await ownedSources())!.json()).toMatchObject({ sources: [{ verificationSource: { id: source.id, walletAddress: payout } }] });
  m.session.mockResolvedValue({ address: author }); expect(await (await ownedSources())!.json()).toMatchObject({ sources: [{ verificationSource: null }] });
  m.db.mockResolvedValue(database({ ...source, walletAddress: `0x${"c".repeat(40)}` }));
  m.session.mockResolvedValue({ address: payout }); expect((await post()).status).toBe(403); expect(m.write).not.toHaveBeenCalled();
});
