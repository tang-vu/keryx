import { expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import { createTopicWatchManagement, type TopicWatchAccountContext } from "../research/topic-watch-service";
import type { TopicWatchMetadataPort, TopicWatchState } from "../research/topic-watches";

const wallet = `0x${"a".repeat(40)}`, base = "https://keryx.example";
const spec = () => ({ watchId: "watch-one", question: "Private question", keywords: ["transformer"], authors: [], venues: [],
  cadenceMs: 60_000, periodMs: 86_400_000, maximumChecksPerPeriod: 4, maximumRowsPerCheck: 32, maximumDigestItems: 16,
  expiresAtMs: Date.now() + 86_400_000, requestedCaps: { perCheckMicroUsdc: 0, perPeriodMicroUsdc: 0 }, consent: { manualMetadata: true, emptyHeartbeat: true } });
function request(body: unknown, revision?: number, origin = base) {
  return new Request(base + "/api/me/topic-watches/watch-one", { method: "POST", headers: { origin, "content-type": "application/json",
    "x-keryx-expected-wallet": wallet, ...(revision === undefined ? {} : { "if-match": `"${revision}"` }) }, body: JSON.stringify(body) });
}
function fixture(read: TopicWatchMetadataPort["read"] = vi.fn(async () => ({ version: 1, scope: "metadata-only", status: "empty", complete: true, rows: [] }))) {
  let state: TopicWatchState | null = null, active = true;
  const issuedAt = Date.now() - 1000, hash = "c".repeat(64);
  const db = { getWebSession: async () => active ? { hash, wallet, issuedAt, expiresAt: issuedAt + 86_400_000 } : null,
    topicWatches: { bindSession: () => ({ read: async () => structuredClone(state), list: async () => state ? [structuredClone(state)] : [],
      compareAndSwap: async (_key: unknown, revision: number | null, next: TopicWatchState, deadline: number) => {
        if (!active || (state?.revision ?? null) !== revision || Date.now() >= deadline) return false;
        state = structuredClone(next); return true;
      } }) } } as unknown as KeryxDB;
  const session = async (): Promise<TopicWatchAccountContext | Response> => active ? { db, wallet, currentId: hash } : new Response(null, { status: 401 });
  return { routes: createTopicWatchManagement(session, base, { read }), read, state: () => state!, revoke: () => { active = false; } };
}
const currentAction = { action: "check-current", consent: "send-keywords-to-crossref-once" };

it("requires exact per-request consent, original owner, same origin and current revision before external metadata", async () => {
  const f = fixture(); expect((await f.routes.create(request(spec()))).status).toBe(201);
  for (const body of [{ action: "check-current" }, { action: "check-current", consent: true },
    { ...currentAction, ownerWallet: wallet }, { action: "check", consent: currentAction.consent }])
    expect((await f.routes.action(request(body, 1), "watch-one")).status).toBe(400);
  expect((await f.routes.action(request(currentAction, 1, "https://foreign.example"), "watch-one")).status).toBe(403);
  expect((await f.routes.action(request(currentAction), "watch-one")).status).toBe(428);
  expect((await f.routes.action(request(currentAction, 99), "watch-one")).status).toBe(409);
  expect(f.read).not.toHaveBeenCalled();
  const response = await f.routes.action(request(currentAction, 1), "watch-one");
  expect(response.status).toBe(200); expect((await response.json()).result).toMatchObject({ status: "unchanged", paidRequests: 0 });
  expect(f.read).toHaveBeenCalledOnce();
});

it("keeps legacy local checks and list operations entirely separate from external discovery", async () => {
  const f = fixture(); await f.routes.create(request(spec()));
  await f.routes.list(new Request(base + "/api/me/topic-watches", { headers: { "x-keryx-expected-wallet": wallet } }));
  const response = await f.routes.action(request({ action: "check" }, 1), "watch-one");
  expect(response.status).toBe(200); expect(f.read).not.toHaveBeenCalled();
});

it("cannot publish a late observation after the original owner session is revoked", async () => {
  let release!: (value: unknown) => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const read = vi.fn(async () => { enter(); return await new Promise(resolve => { release = resolve; }); });
  const f = fixture(read); await f.routes.create(request(spec()));
  const response = f.routes.action(request(currentAction, 1), "watch-one"); await entered;
  f.revoke(); release({ version: 1, scope: "metadata-only", status: "empty", complete: true, rows: [] });
  expect((await response).status).toBe(503); expect(f.state().watermark).toHaveLength(0); expect(read).toHaveBeenCalledOnce();
});
