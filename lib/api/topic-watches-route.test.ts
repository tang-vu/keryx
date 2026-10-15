import { describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import type { TopicWatchState } from "../research/topic-watches";
import { createTopicWatchManagement, type TopicWatchAccountContext } from "../research/topic-watch-service";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const base = "https://keryx.example";
const input = () => ({ watchId: "private-watch", question: "Which transformer papers?", keywords: ["transformer"], authors: [], venues: [],
  cadenceMs: 60_000, periodMs: 86_400_000, maximumChecksPerPeriod: 4, maximumRowsPerCheck: 32, maximumDigestItems: 16,
  expiresAtMs: Date.now() + 86_400_000, requestedCaps: { perCheckMicroUsdc: 0, perPeriodMicroUsdc: 0 },
  consent: { manualMetadata: true, emptyHeartbeat: true } });
function request(method = "GET", body?: unknown, changes: Record<string, string> = {}) {
  return new Request(`${base}/api/me/topic-watches`, { method, headers: { origin: base, "x-keryx-expected-wallet": alice,
    ...(body === undefined ? {} : { "content-type": "application/json" }), ...changes },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function fixture() {
  const rows = new Map<string, TopicWatchState>(), issuedAt = Date.now() - 1000;
  let context: TopicWatchAccountContext | Response, active = true;
  const read = vi.fn(async (key: { ownerWallet: string; watchId: string }) => structuredClone(rows.get(`${key.ownerWallet}/${key.watchId}`) ?? null));
  const write = vi.fn(async (key: { ownerWallet: string; watchId: string }, revision: number | null, next: TopicWatchState, deadline: number) => {
    const name = `${key.ownerWallet}/${key.watchId}`, prior = rows.get(name);
    if (!active || (prior?.revision ?? null) !== revision || Date.now() >= deadline) return false;
    rows.set(name, structuredClone(next)); return true;
  });
  let bound!: () => void;
  const boundEntered = new Promise<void>(resolve => { bound = resolve; });
  const db = { getWebSession: vi.fn(async () => active ? { hash: "c".repeat(64), wallet: alice, issuedAt, expiresAt: issuedAt + 86_400_000 } : null),
    topicWatches: { bindSession: vi.fn(() => { bound(); return { read, compareAndSwap: write, list: async () => structuredClone([...rows.values()]) }; }) } } as unknown as KeryxDB;
  context = { db, wallet: alice, currentId: "c".repeat(64) };
  const session = vi.fn(async () => context), routes = createTopicWatchManagement(session, base);
  return { db, rows, read, write, session, routes, boundEntered,
    replace: () => { context = { db, wallet: alice, currentId: "d".repeat(64) }; },
    revoke: () => { active = false; context = new Response(null, { status: 401 }); } };
}
describe("private watch API (authored, UNRUN; native store acceptance is separate)", () => {
  it("mounted create/list/read/edit/pause/resume/check/cancel use the same private owner", async () => {
    const f = fixture();
    expect((await f.routes.create(request("POST", input()))).status).toBe(201);
    expect((await f.routes.list(request())).headers.get("cache-control")).toContain("no-store");
    expect((await (await f.routes.read(request(), "private-watch")).json()).watch.key.ownerWallet).toBe(alice);
    expect((await f.routes.update(request("PUT", { ...input(), question: "Edited review question" }, { "if-match": '"1"' }), "private-watch")).status).toBe(200);
    expect((await f.routes.action(request("POST", { action: "pause" }, { "if-match": '"2"' }), "private-watch")).status).toBe(200);
    expect((await f.routes.action(request("POST", { action: "resume" }, { "if-match": '"3"' }), "private-watch")).status).toBe(200);
    const check = await f.routes.action(request("POST", { action: "check" }, { "if-match": '"4"' }), "private-watch");
    const result = (await check.json()).result;
    expect(result).toMatchObject({ paidRequests: 0, standingSpend: "withheld" });
    const revision = f.rows.get(`${alice}/private-watch`)!.revision;
    expect((await f.routes.cancel(request("DELETE", undefined, { "if-match": `"${revision}"` }), "private-watch")).status).toBe(200);
    expect(f.rows.get(`${alice}/private-watch`)!.status).toBe("cancelled");
    expect((await f.routes.create(request("POST", input()))).status).toBe(409);
  });
  it.each([{}, { ownerWallet: bob }, { wallet: alice }])("rejects invalid/body owner authority %j without a write", async extra => {
    const f = fixture();
    const body = Object.keys(extra).length ? { ...input(), ...extra } : { ...input(), consent: { manualMetadata: false, emptyHeartbeat: false } };
    expect((await f.routes.create(request("POST", body))).status).toBe(400); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["https://evil.example", "http://keryx.example", "null"])("refuses mutation origin %s before session/storage", async origin => {
    const f = fixture(); expect((await f.routes.create(request("POST", input(), { origin }))).status).toBe(403);
    expect(f.session).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });
  it("requires expected wallet and revision; bearer keys never acquire private access", async () => {
    const f = fixture();
    expect((await f.routes.list(new Request(`${base}/api/me/topic-watches`))).status).toBe(428);
    expect((await f.routes.list(request("GET", undefined, { "x-keryx-expected-wallet": bob }))).status).toBe(409);
    expect((await f.routes.list(request("GET", undefined, { authorization: "Bearer old-api-key" }))).status).toBe(401);
    expect((await f.routes.action(request("POST", { action: "pause" }), "private-watch")).status).toBe(428);
    expect(f.write).not.toHaveBeenCalled();
  });
  it("refuses missing selected storage and nonzero requested spend, without a fallback", async () => {
    const f = fixture();
    expect((await f.routes.create(request("POST", { ...input(), requestedCaps: { perCheckMicroUsdc: 1, perPeriodMicroUsdc: 1 } }))).status).toBe(422);
    const db = { getWebSession: f.db.getWebSession } as KeryxDB;
    const routes = createTopicWatchManagement(async () => ({ db, wallet: alice, currentId: "c".repeat(64) }), base);
    expect((await routes.list(request())).status).toBe(503); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["replace", "revoke"] as const)("keeps original authority after %s during the body await", async mode => {
    const f = fixture(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const req = new Request(`${base}/api/me/topic-watches`, { method: "POST", headers: { origin: base,
      "content-type": "application/json", "x-keryx-expected-wallet": alice }, body: stream, duplex: "half" } as RequestInit);
    const running = f.routes.create(req); await f.boundEntered; f[mode]();
    controller.enqueue(new TextEncoder().encode(JSON.stringify(input()))); controller.close();
    expect((await running).status).toBe(503); expect(f.write).not.toHaveBeenCalled();
  });
  it("suppresses private data after same-wallet replacement during an awaited store read", async () => {
    const f = fixture(); let finish!: (value: TopicWatchState | null) => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    f.read.mockImplementationOnce(() => { entered(); return new Promise(resolve => { finish = resolve; }); });
    const running = f.routes.read(request(), "private-watch"); await waiting; f.replace(); finish(null);
    const response = await running; expect(response.status).toBe(503); expect(await response.text()).not.toContain("question");
  });
  it("bounds malformed bodies, rejects query selectors and stale revisions", async () => {
    const f = fixture(); await f.routes.create(request("POST", input()));
    expect((await f.routes.cancel(request("DELETE", undefined, { "if-match": '"9"' }), "private-watch")).status).toBe(409);
    expect((await f.routes.create(request("POST", { ...input(), question: "x".repeat(17000) }))).status).toBe(400);
    expect((await f.routes.list(new Request(`${base}/api/me/topic-watches?wallet=${bob}`))).status).toBe(400);
  });
});
