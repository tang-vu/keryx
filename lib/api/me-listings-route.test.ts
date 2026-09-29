import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sourceId } from "@/lib/registry/registry-client";

const m = vi.hoisted(() => ({
  session: vi.fn(), db: vi.fn(), registry: vi.fn(),
  config: { registryAddress: "", registryReadAddress: "" },
}));
vi.mock("@/lib/auth", () => ({ getSession: m.session }));
vi.mock("@/lib/db", () => ({ getDb: m.db }));
vi.mock("@/lib/config", () => ({ config: m.config }));
vi.mock("@/lib/registry/registry-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/registry/registry-client")>(),
  getRegistrySource: m.registry,
}));
vi.mock("@/lib/notify/citation-email", () => ({
  emailNotifyConfigured: () => true,
  isValidAlertEmail: () => true,
  randomUnsubToken: () => "test-token",
}));

import { GET as listingsGET } from "@/app/api/me/listings/route";
import { GET as privateGET, POST as privatePOST } from "@/app/api/me/sources/route";

const creator = `0x${"a".repeat(40)}`;
const payout = `0x${"b".repeat(40)}`;
const other = `0x${"c".repeat(40)}`;
const registryAddress = `0x${"d".repeat(40)}`;
const url = "https://example.com/creator-feed";
const id = sourceId(creator as `0x${string}`, url);
const otherId = sourceId(other as `0x${string}`, "https://example.com/other-feed");
const getListings = (cursor?: string) => listingsGET(new NextRequest(
  `https://keryx.cc/api/me/listings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
));
const source = (over: Record<string, unknown> = {}) => ({
  id: "mine", name: "My feed", url, walletAddress: payout,
  authors: [{ walletAddress: payout }], onchainId: id, active: false,
  ...over,
});

let db: {
  listAllSources: ReturnType<typeof vi.fn>;
  creatorLeaderboard: ReturnType<typeof vi.fn>;
  getSourceNotifyEmail: ReturnType<typeof vi.fn>;
  getSourceNotify: ReturnType<typeof vi.fn>;
  setSourceNotifyEmail: ReturnType<typeof vi.fn>;
  deleteSourceNotifyEmail: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.config.registryAddress = registryAddress;
  m.config.registryReadAddress = registryAddress;
  m.session.mockResolvedValue({ address: creator.toUpperCase() });
  db = {
    listAllSources: vi.fn().mockResolvedValue([source()]),
    creatorLeaderboard: vi.fn().mockResolvedValue([{ sourceId: "mine", totalEarnedUsdc: 2, citationCount: 3 }]),
    getSourceNotifyEmail: vi.fn().mockResolvedValue({ email: "private@example.com" }),
    getSourceNotify: vi.fn().mockResolvedValue({ url: "https://private.example/webhook" }),
    setSourceNotifyEmail: vi.fn(),
    deleteSourceNotifyEmail: vi.fn(),
  };
  m.db.mockResolvedValue(db);
  m.registry.mockResolvedValue({ creator, active: true });
});

it("finds the registry creator with a separate payout using one live read and public fields only", async () => {
  const response = await getListings();
  expect(response.status).toBe(200);
  expect(m.registry).toHaveBeenCalledExactlyOnceWith(id, { timeoutMs: 4_000 });
  expect(await response.json()).toEqual({
    listings: [{ id: "mine", name: "My feed", active: true }], nextCursor: null, uncertain: 0,
  });
  expect(db.creatorLeaderboard).not.toHaveBeenCalled();
  expect(db.getSourceNotifyEmail).not.toHaveBeenCalled();
  expect(db.getSourceNotify).not.toHaveBeenCalled();
});

it("does not read unrelated registry records or leak other owners' listings", async () => {
  db.listAllSources.mockResolvedValue([
    source(),
    source({ id: "other", url: "https://example.com/other-feed", onchainId: otherId,
      walletAddress: creator, authors: [{ walletAddress: creator }] }),
    source({ id: "offline", onchainId: undefined, walletAddress: creator }),
  ]);
  const response = await getListings();
  expect(await response.json()).toEqual({
    listings: [{ id: "mine", name: "My feed", active: true }], nextCursor: null, uncertain: 0,
  });
  expect(m.registry).toHaveBeenCalledExactlyOnceWith(id, { timeoutMs: 4_000 });
});

it("returns an empty public list without RPC when only other creators or offline rows exist", async () => {
  db.listAllSources.mockResolvedValue([source({ onchainId: otherId })]);
  m.config.registryReadAddress = other;
  expect(await (await getListings()).json()).toEqual({ listings: [], nextCursor: null, uncertain: 0 });
  expect(m.registry).not.toHaveBeenCalled();
});

it("finds an RSS-only registration when the cached homepage URL is blank", async () => {
  db.listAllSources.mockResolvedValue([source({ url: "", rssUrl: url })]);
  expect(await (await getListings()).json()).toMatchObject({
    listings: [{ id: "mine" }], nextCursor: null, uncertain: 0,
  });
  expect(m.registry).toHaveBeenCalledExactlyOnceWith(id, { timeoutMs: 4_000 });
});

it("pages metadata-free rows with at most four concurrent timed reads", async () => {
  const rows = Array.from({ length: 13 }, (_, index) => source({
    id: `metadata-${String(index).padStart(2, "0")}`, url: "", rssUrl: undefined,
    onchainId: `0x${String(index + 1).padStart(64, "0")}`,
  }));
  db.listAllSources.mockResolvedValue(rows);
  let inFlight = 0;
  let peak = 0;
  m.registry.mockImplementation(async (chainId: string) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight--;
    return { creator: chainId === rows[12].onchainId ? creator : other, active: true };
  });
  const first = await (await getListings()).json();
  expect(first).toEqual({ listings: [], nextCursor: "metadata-11", uncertain: 0 });
  expect(m.registry).toHaveBeenCalledTimes(12);
  expect(peak).toBeLessThanOrEqual(4);
  expect(peak).toBeGreaterThan(1);
  const second = await (await getListings(first.nextCursor)).json();
  expect(second).toEqual({
    listings: [{ id: "metadata-12", name: "My feed", active: true }], nextCursor: null, uncertain: 0,
  });
  expect(m.registry).toHaveBeenCalledTimes(13);
});

it("returns verified listings alongside explicit uncertainty from another candidate's failed read", async () => {
  const secondUrl = "https://example.com/second";
  const secondId = sourceId(creator as `0x${string}`, secondUrl);
  db.listAllSources.mockResolvedValue([source(), source({ id: "second", url: secondUrl, onchainId: secondId })]);
  m.registry.mockImplementation(async (chainId: string) => {
    if (chainId === id) throw new Error("private-rpc-sentinel");
    return { creator, active: true };
  });
  const response = await getListings();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    listings: [{ id: "second", name: "My feed", active: true }], nextCursor: null, uncertain: 1,
  });
});

it("treats a supplied cursor only as a narrowing position", async () => {
  expect(await (await getListings("zzzz")).json()).toEqual({
    listings: [], nextCursor: null, uncertain: 0,
  });
  expect(m.registry).not.toHaveBeenCalled();
});

it.each(["missing", "failure", "mismatch", "config"])("withholds matching listing on %s", async state => {
  if (state === "missing") m.registry.mockResolvedValue(null);
  if (state === "failure") m.registry.mockRejectedValue(new Error("private-rpc-sentinel"));
  if (state === "mismatch") m.registry.mockResolvedValue({ creator: other, active: true });
  if (state === "config") m.config.registryReadAddress = other;
  const response = await getListings();
  expect(response.status).toBe(state === "config" ? 409 : 200);
  expect(await response.text()).not.toContain("private-rpc-sentinel");
  if (state !== "config") {
    const body = await (await getListings()).json();
    expect(body.listings).toEqual([]);
    expect(body.uncertain).toBe(state === "failure" || state === "mismatch" ? 1 : 0);
  }
  expect(db.getSourceNotifyEmail).not.toHaveBeenCalled();
});

it("keeps private portfolio and bulk email access with payout recipients, not registry-only creators", async () => {
  const creatorResponse = await privateGET();
  expect(await creatorResponse!.json()).toMatchObject({ sources: [] });
  expect((await privatePOST(new NextRequest("https://keryx.cc/api/me/sources", {
    method: "POST", body: JSON.stringify({ email: "creator@example.com" }),
  })))?.status).toBe(404);
  expect(db.getSourceNotifyEmail).not.toHaveBeenCalled();
  expect(db.setSourceNotifyEmail).not.toHaveBeenCalled();

  m.session.mockResolvedValue({ address: payout });
  const payoutResponse = await privateGET();
  expect(await payoutResponse!.json()).toMatchObject({ sources: [{ id: "mine", email: "private@example.com" }] });
  expect((await privatePOST(new NextRequest("https://keryx.cc/api/me/sources", {
    method: "POST", body: JSON.stringify({ email: "payout@example.com" }),
  })))?.status).toBe(200);
  expect(db.setSourceNotifyEmail).toHaveBeenCalledWith("mine", "payout@example.com", "test-token");
  expect(m.registry).not.toHaveBeenCalled();
});

it("authenticates before database or registry access", async () => {
  m.session.mockResolvedValue(null);
  expect((await getListings()).status).toBe(401);
  expect(m.db).not.toHaveBeenCalled();
  expect(m.registry).not.toHaveBeenCalled();
});
