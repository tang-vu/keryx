import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import { encryptContent } from "../ipfs/content-crypto";
import type { Citation, QueryRun } from "../types";
import type { ZoteroLease, ZoteroStore } from "./zotero-contract";
import { createZoteroRoutes } from "./zotero-routes";

const owner = `0x${"a".repeat(40)}`, collection = "ABCD2345", token = "SYNTHETICKEY000000000001";
afterEach(() => vi.unstubAllEnvs());
function held() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
function fixture(count = 1) {
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  const citations: Citation[] = Array.from({ length: count }, (_, index) => ({ marker: `S${index + 1}`, sourceId: `source-${index}`, sourceName: "Synthetic publisher",
    itemId: `item-${index}`, itemTitle: `Synthetic reference ${index}`, itemUrl: `https://source.example/item/${index}`, contentVersion: "sha256:one",
    weight: 1, reward: 0, rationale: "synthetic" }));
  const run = { id: "owned-report", createdAt: "2026-10-12T00:00:00.000Z", citations, evidence: [] } as unknown as QueryRun;
  const publication = { exists: true, item: { run, state: { visibility: "public" as "public" | "private" | "unlisted", revision: 0, erased: false } } };
  const read = vi.fn(async () => publication), owned = vi.fn(async () => ({ run }));
  const lease: ZoteroLease = { owner, userId: "1234", generation: "synthetic-generation", lease: "synthetic-lease",
    encrypted: encryptContent(token, new TextEncoder().encode(`keryx-zotero-token-v1:${owner}:1234`)) };
  const keys = new Map<string, string>(), alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
  const store: ZoteroStore = {
    status: async () => ({ connected: true, userId: "1234" }), acquire: async () => lease, check: async () => {},
    connect: async () => {}, revoke: async () => {}, release: async () => {}, backoff: async () => {},
    key: async (_lease, _user, identity) => {
      if (!keys.has(identity)) { const index = keys.size; keys.set(identity, `222222${alphabet[Math.floor(index / 32)]}${alphabet[index % 32]}`); }
      return keys.get(identity)!;
    },
  };
  const calls: Array<{ method: string; body?: Record<string, unknown>[] }> = [];
  const controls = { beforeItems: async () => {}, afterWrite: () => {} };
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined;
    expect(url.origin).toBe("https://api.zotero.org"); expect(new Headers(init?.headers).get("Zotero-API-Key")).toBe(token);
    calls.push({ method, body });
    const headers = { "Last-Modified-Version": "1" };
    if (url.pathname === "/keys/current") return Response.json({ userID: 1234, access: { user: { library: true, notes: true, write: true, files: false }, groups: {} } }, { headers });
    if (url.pathname === "/users/1234/collections") return Response.json([{ key: collection, data: { name: "Synthetic selected collection" } }], { headers: { ...headers, "Total-Results": "1" } });
    if (url.pathname === "/users/1234/items" && method === "GET") { await controls.beforeItems(); return Response.json([], { headers: { ...headers, "Total-Results": "0" } }); }
    if (url.pathname === "/users/1234/items" && method === "POST") {
      const successful = Object.fromEntries((body as Record<string, unknown>[]).map((fields, index) => [String(index), { key: fields.key, version: 2, data: { ...fields, version: 2 } }]));
      controls.afterWrite(); return Response.json({ successful, unchanged: {}, failed: {} }, { headers: { "Last-Modified-Version": "2" } });
    }
    throw new Error("Unexpected synthetic request");
  });
  const db = { zotero: store, runOwnershipHistory: { read: owned }, runPrivacyActive: true, runPrivacy: { read } };
  const routes = createZoteroRoutes(async () => ({ wallet: owner, db: db as unknown as KeryxDB }), "https://keryx.example", "eip155:5042002", () => true, transport);
  const request = () => new Request("https://keryx.example/api/me/references/zotero/send", { method: "POST",
    headers: { Origin: "https://keryx.example", "X-Keryx-Expected-Wallet": owner, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "report", reportId: run.id, collection }) });
  return { run, publication, read, owned, db, controls, calls, send: () => routes.send(request()) };
}

describe("Zotero report publication boundary", () => {
  it("requires an actual port when the captured privacy stage is active", async () => {
    const f = fixture(); delete (f.db as { runPrivacy?: unknown }).runPrivacy;
    const response = await f.send(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "zotero_unavailable" }); expect(f.calls).toEqual([]);
  });
  it("requires an actual port when only the incoming ENV flag activates privacy", async () => {
    const f = fixture(); delete (f.db as { runPrivacyActive?: boolean }).runPrivacyActive; delete (f.db as { runPrivacy?: unknown }).runPrivacy;
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
    expect((await f.send()).status).toBe(503); expect(f.calls).toEqual([]);
  });
  it("preserves explicit OFF legacy ownership behavior without calling a supplied privacy reader", async () => {
    const f = fixture(); f.db.runPrivacyActive = false; f.publication.item.state.visibility = "private"; vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
    expect((await f.send()).status).toBe(200); expect(f.read).not.toHaveBeenCalled(); expect(f.calls.filter(call => call.method === "POST")).toHaveLength(1);
  });
  it.each(["private", "unlisted", "erased"])("refuses %s publication before provider I/O", async state => {
    const f = fixture(); if (state === "erased") f.publication.item.state.erased = true; else f.publication.item.state.visibility = state as "private" | "unlisted";
    expect((await f.send()).status).toBe(404); expect(f.calls).toEqual([]);
  });
  it("refuses malformed publication revisions rather than reporting empty success", async () => {
    const f = fixture(); f.publication.item.state.revision = -1;
    expect((await f.send()).status).toBe(503); expect(f.calls).toEqual([]);
  });
  it("binds the actual public export to the existing owner/network/origin reader and revision zero", async () => {
    const f = fixture(); expect((await f.send()).status).toBe(200);
    expect(f.owned).toHaveBeenCalledWith(owner, { network: "eip155:5042002", origin: "https://keryx.example" }, f.run.id);
    expect(f.read).toHaveBeenCalledTimes(3); expect(f.calls.filter(call => call.method === "POST")[0].body).toHaveLength(2);
  });
  it.each(["private", "revision", "export", "erase"])("withholds the write after %s changes during a held library read", async change => {
    const f = fixture(), seen = held(), response = held();
    f.controls.beforeItems = async () => { seen.open(); await response.promise; };
    const sending = f.send(); await seen.promise;
    if (change === "private") f.publication.item.state.visibility = "private";
    if (change === "revision") f.publication.item.state.revision++;
    if (change === "export") f.publication.item.run = { ...f.run, citations: [{ ...f.run.citations[0], itemTitle: "Changed current export" }] };
    if (change === "erase") f.publication.item.state.erased = true;
    response.open(); expect((await sending).status).toBe(change === "revision" || change === "export" ? 409 : 404);
    expect(f.calls.filter(call => call.method === "POST")).toHaveLength(0);
  });
  it("rechecks publication between bounded batches without recalling an already accepted write or retrying", async () => {
    const f = fixture(26); f.controls.afterWrite = () => { f.publication.item.state.visibility = "private"; };
    expect((await f.send()).status).toBe(404);
    const writes = f.calls.filter(call => call.method === "POST"); expect(writes).toHaveLength(1); expect(writes[0].body).toHaveLength(50);
  });
});
