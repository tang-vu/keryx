import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import { createAcceptanceRoute } from "./route";
import { acceptanceFixture } from "./test-fixture";
const open: Array<{ close(): void }> = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });
const id = `a2a_${"1".repeat(64)}`, alice = `0x${"11".repeat(20)}`, bob = `0x${"22".repeat(20)}`;
const key = `kx_live_${"a".repeat(96)}`;
const context = (value = id) => ({ params: Promise.resolve({ id: value }) });
function setup() {
  const port = { read: vi.fn().mockResolvedValue({ synthetic: true }), submit: vi.fn().mockResolvedValue({ synthetic: true }), publicState: vi.fn() };
  const db = { deliverableAcceptance: port } as unknown as KeryxDB;
  const deps = { session: vi.fn().mockResolvedValue({ db, wallet: alice, currentId: "1".repeat(64) }),
    key: vi.fn().mockResolvedValue({ walletAddress: alice, keyId: "synthetic-key", scopes: "deliverable:read,deliverable:write" }),
    db: vi.fn().mockResolvedValue(db), network: "eip155:5042002", baseUrl: "https://keryx.example" };
  return { deps, port, read: createAcceptanceRoute(deps, false), write: createAcceptanceRoute(deps, true) };
}
const req = (headers: Record<string, string> = {}, data?: unknown) => new Request(`http://localhost/api/me/deliverables/${id}/acceptance`, {
  method: data === undefined ? "GET" : "POST", headers, body: data === undefined ? undefined : JSON.stringify(data),
});
const input = { originalFingerprint: "1".repeat(64), deliveredDigest: "2".repeat(64), expectedRevision: 0,
  idempotencyKey: "synthetic-request-0001", choice: "accept", reason: "", publishState: false };
describe("owner-bound deliverable HTTP", () => {
  it("requires captured session owner before hydration; missing428 and stale owner409", async () => {
    const { read, deps, port } = setup(); const missing = await read(req(), context()); expect(missing.status).toBe(428); expect(deps.session).not.toHaveBeenCalled();
    const stale = await read(req({ "X-Keryx-Expected-Wallet": bob }), context()); expect(stale.status).toBe(409); expect(port.read).not.toHaveBeenCalled();
    expect(stale.headers.get("cache-control")).toBe("private, no-store"); expect(stale.headers.get("vary")).toBe("Authorization, Cookie");
  });
  it.each(["https://evil.example", "https://keryx.example:444", "http://keryx.example", "null", "https://keryx.example/path"])("refuses cookie Origin %s without reading body/store", async origin => {
    const { write, deps, port } = setup(), request = req({ origin, "X-Keryx-Expected-Wallet": alice }, input);
    const response = await write(request, context()); expect(response.status).toBe(403); expect(request.bodyUsed).toBe(false); expect(deps.session).not.toHaveBeenCalled(); expect(port.submit).not.toHaveBeenCalled();
  });
  it("configured public Origin works with canonical Next internal URL and ignores forwarded authority", async () => {
    const { write, port } = setup(); const response = await write(req({ origin: "https://keryx.example", "Content-Type": "application/json", "X-Keryx-Expected-Wallet": alice,
      host: "evil.example", "x-forwarded-host": "evil.example" }, input), context());
    expect(response.status).toBe(200); expect(port.submit).toHaveBeenCalledWith(alice, "eip155:5042002", id, input, { kind: "session", id: "1".repeat(64) });
  });
  it("bearer never falls back to session; unknown/legacy scopes cannot hydrate an original", async () => {
    const { write, deps, port } = setup();
    expect((await write(req({ Authorization: "Bearer malformed" }, input), context())).status).toBe(401);
    deps.key.mockResolvedValueOnce({ walletAddress: alice, keyId: "synthetic-key", scopes: "ask,export" });
    const request = req({ Authorization: `Bearer ${key}` }, input);
    expect((await write(request, context())).status).toBe(403); expect(request.bodyUsed).toBe(false); expect(deps.session).not.toHaveBeenCalled(); expect(port.submit).not.toHaveBeenCalled();
  });
  it("refuses unsupported native no-port before consuming the body or writing anything", async () => {
    const { write, deps, port } = setup(); deps.db.mockResolvedValueOnce({} as KeryxDB);
    const request = req({ Authorization: `Bearer ${key}` }, input), response = await write(request, context());
    expect(response.status).toBe(503); expect(request.bodyUsed).toBe(false); expect(port.submit).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "acceptance_unavailable" });
  });
  it.each([{ ...input, wallet: bob }, { ...input, network: "eip155:5042" }, { ...input, reason: "\ud800" }, { ...input, expectedRevision: -1 }])("rejects closed malformed submission before journal write", async body => {
    const { write, port } = setup(); expect((await write(req({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body), context())).status).toBe(400); expect(port.submit).not.toHaveBeenCalled();
  });
  it("actual ordinary adapter rejects a key revoked between HTTP verification and journal admission", async () => {
    const f = await acceptanceFixture(); open.push(f.db);
    const deps = { session: async () => new Response(null, { status: 401 }), db: async () => f.db, network: f.fixture.binding.network, baseUrl: "https://keryx.example",
      key: async () => { await f.db.revokeApiKey(f.authority.id, f.fixture.order.payer); return { walletAddress: f.fixture.order.payer, keyId: f.authority.id, scopes: "deliverable:write" }; } };
    const request = req({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, f.input);
    const result = await createAcceptanceRoute(deps, true)(request, context(f.fixture.order.id)); expect(result.status).toBe(401);
    expect((await f.port.read(f.fixture.order.payer, deps.network, f.fixture.order.id)).revision).toBe(0);
  });
});
