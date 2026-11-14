import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { issueWebSession, webSessionHash } from "../../auth-session";
import type { KeryxDB, WebSessionRecord } from "../keryx-db";
import { a2aOrderId, type A2aOrder } from "../../a2a/order";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../storage-identity";
import { canonicalJson } from "../../canonical-json";
import { ARC_MAINNET_PROFILE } from "../../arc-network-profile";
import { pendingOwnerRequestSession, pendingOwnerSettlementSession, retainedPendingOwnerSession,
  capturePostgresPendingOwnerAdmission, capturePostgresPendingOwnerSession, type PendingOwnerSessionProof } from "../../a2a/pending-owner-session";
import { composePostgresPendingJobOwners } from "./pending-owner-transport";
import { composePostgresA2aOriginals } from "./a2a-originals-transport";
import { syntheticA2aOriginal } from "../a2a-original-fixture";
import { monthlyOrderToRow } from "../research-monthly";
import type { PostgresDomainChannel } from "./domain-channel";

// Unit-only provenance stand-ins. They exercise the real signed-cookie producer;
// they do not qualify an installed native writer (which remains closed).
const fixture = vi.hoisted(() => ({ token: "", manifest: undefined as unknown, db: undefined as unknown,
  nativeIdentity: vi.fn(), sqliteIdentity: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "keryx_session" && fixture.token ? { value: fixture.token } : undefined }) }));
vi.mock("../../config", () => ({ config: { networkId: "eip155:5042", jwtSecret: "offline-fixture-secret-with-no-authority" } }));
vi.mock("..", () => ({ getDb: async () => fixture.db }));
vi.mock("../runtime-storage-config", () => ({ readRuntimeStorageDeployment: () => fixture.manifest }));
vi.mock("./runtime-adapter", () => ({ assertPostgresRuntimeIdentity: fixture.nativeIdentity }));
vi.mock("../enrolled-sqlite-adapter", () => ({ assertEnrolledSqliteAdapter: fixture.sqliteIdentity }));

const now = Date.parse("2026-11-14T00:00:00.000Z"), wallet = `0x${"11".repeat(20)}`;
const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", deploymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  storageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", network: "eip155:5042", authorityMode: "mainnet-real",
  profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, enrollmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "d".repeat(64) };
const order = (): A2aOrder => {
  const binding = { network: identity.network, payer: `0x${"22".repeat(20)}`, payee: `0x${"33".repeat(20)}`, authorizationId: `0x${"44".repeat(32)}` };
  const id = a2aOrderId(binding);
  return { ...binding, id, queryId: id, requestHash: "a".repeat(64), createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(), request: { network: identity.network, question: "fixture", origin: "a2a" },
    status: "running", startedAt: null, workerId: null, response: null, resolution: null } as A2aOrder;
};
let durable: WebSessionRecord | null;
const db = { pendingJobOwners: {}, async createWebSession(row: WebSessionRecord) { durable = row; }, async getWebSession() { return durable; } };
function request(binding = true, headers: Record<string, string> = {}) {
  return new Request(`https://keryx.example${binding ? "/api/agent/ask" : "/api/me/jobs"}`, {
    method: binding ? "POST" : "GET", headers: { ...(binding ? { origin: "https://keryx.example", "x-keryx-account-job": "associate" } : {}), ...headers },
  });
}
async function proof(read = false) {
  const original = order();
  return pendingOwnerRequestSession(request(!read), read ? undefined : { id: original.id, requestHash: original.requestHash });
}
function channelFixture() {
  let closed = false;
  const call = vi.fn<PostgresDomainChannel["call"]>().mockResolvedValue(true);
  const channel: PostgresDomainChannel = { get closed() { return closed; }, call, async close() { closed = true; } };
  return { channel, call, port: composePostgresPendingJobOwners(channel, identity, false) };
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  fixture.nativeIdentity.mockReset().mockResolvedValue(identity); fixture.sqliteIdentity.mockReset().mockReturnValue(identity);
  fixture.manifest = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "postgres", database: "offline_fixture" } };
  fixture.db = db; durable = null;
  fixture.token = (await issueWebSession(db as unknown as KeryxDB, "offline-fixture-secret-with-no-authority", wallet, "asker")).token;
});
afterEach(() => { vi.useRealTimers(); });

describe("owned create selected-deployment boundary", () => {
  const deployment = () => ({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "postgres", database: "offline_fixture",
    sourceDigest: "a".repeat(64), endpoint: { kind: "loopback", port: 5432 },
    credentialPaths: { application: "D:/offline-application.json", reader: "D:/offline-reader.json" } } });
  const original = () => ({ ...syntheticA2aOriginal(1870, ARC_MAINNET_PROFILE).order, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });
  it("submits the captured owned packet when the complete selected deployment stays current", async () => {
    fixture.manifest = deployment();
    const input = original();
    const selected = await pendingOwnerRequestSession(request(), { id: input.id, requestHash: input.requestHash });
    const { channel, call } = channelFixture();
    call.mockImplementation(async operation => operation === "a2aOriginalStore"
      ? { storeId: "3821e833-f4ca-44d3-a944-0cf892ab0b85" } : { created: true, order: monthlyOrderToRow(input) });
    expect((await composePostgresA2aOriginals(channel, false, identity).createOwnedA2aOrder(input, selected)).created).toBe(true);
    expect(call.mock.calls.map(row => row[0])).toEqual(["a2aOriginalStore", "a2aCreate"]);
  });
  it.each(["database", "sourceDigest", "endpoint", "credentialPaths"] as const)("refuses same-identity %s drift during the context await before writing", async field => {
    const pinned = deployment(); fixture.manifest = pinned;
    const input = original();
    const selected = await pendingOwnerRequestSession(request(), { id: input.id, requestHash: input.requestHash });
    const { channel, call } = channelFixture();
    call.mockImplementation(async () => {
      const changed = field === "database" ? "another_database" : field === "sourceDigest" ? "b".repeat(64)
        : field === "endpoint" ? { kind: "loopback", port: 5433 }
        : { application: "D:/another-application.json", reader: "D:/offline-reader.json" };
      fixture.manifest = { ...pinned, backend: { ...pinned.backend, [field]: changed } };
      return { storeId: "3821e833-f4ca-44d3-a944-0cf892ab0b85" };
    });
    await expect(composePostgresA2aOriginals(channel, false, identity).createOwnedA2aOrder(input, selected)).rejects.toThrow();
    expect(call.mock.calls.map(row => row[0])).toEqual(["a2aOriginalStore"]);
  });
});

describe("native pending owner signed-cookie proof", () => {
  it("requires native installed write provenance and captures only exact original/session metadata", async () => {
    const selected = await proof(), original = order();
    expect(fixture.nativeIdentity).toHaveBeenCalledWith(db, "write"); expect(fixture.sqliteIdentity).not.toHaveBeenCalled();
    const packet = capturePostgresPendingOwnerAdmission(selected, identity, original);
    expect(packet.identity).toEqual(identity); expect(Object.keys(packet.identity)).toHaveLength(9);
    expect(packet.session).toEqual(durable); expect(packet.proofExpiresAt).toBe(now + 300000);
    expect(packet.binding).toEqual({ id: original.id, requestHash: original.requestHash });
    expect(packet.original).toEqual({ id: original.id, queryId: original.id, requestHash: original.requestHash,
      network: identity.network, createdAt: original.createdAt });
    expect(JSON.stringify(packet)).not.toContain("fixture"); expect(packet).not.toHaveProperty("payer");
    expect(() => capturePostgresPendingOwnerAdmission(selected, identity, original)).toThrow("session_unavailable");
  });
  it("cannot turn a read facade or absent durable session into an admission proof", async () => {
    fixture.nativeIdentity.mockRejectedValue(new Error("readonly_operation"));
    await expect(proof()).rejects.toThrow("readonly_operation");
    fixture.nativeIdentity.mockResolvedValue(identity); durable = null;
    await expect(proof()).rejects.toThrow("session_unavailable");
  });
  it.each(["authorization", "x-api-key", "x-keryx-api-key"])("rejects %s authentication in the account association path", async header => {
    const original = order();
    await expect(pendingOwnerRequestSession(request(true, { [header]: "untrusted" }), original)).rejects.toThrow("session_unavailable");
    expect(fixture.nativeIdentity).not.toHaveBeenCalled();
  });
  it.each(["https://foreign.example", "null", "https://keryx.example/forged"])("rejects foreign or malformed origin %s", async origin => {
    await expect(pendingOwnerRequestSession(request(true, { origin }), order())).rejects.toThrow("session_unavailable");
  });
  it("accepts only the real signed cookie and refuses forged metadata, JWT and missing cookie", async () => {
    const { port, call } = channelFixture();
    expect(() => port.assertAdmission(Object.freeze({}) as PendingOwnerSessionProof)).toThrow("session_unavailable");
    expect(() => capturePostgresPendingOwnerAdmission({ hash: durable!.hash, wallet } as unknown as PendingOwnerSessionProof, identity, order())).toThrow("session_unavailable");
    fixture.token = `${fixture.token.slice(0, -10)}not-a-jwt`;
    await expect(proof()).rejects.toThrow("session_unavailable"); fixture.token = "";
    await expect(proof()).rejects.toThrow("session_unavailable"); expect(call).not.toHaveBeenCalled();
  });
  it("preserves the synchronous SQLite proof and forbids cross-backend proof substitution", async () => {
    fixture.manifest = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: "D:/offline-fixture.sqlite" } };
    const selected = await proof(); expect(fixture.sqliteIdentity).toHaveBeenCalledWith(db, "write");
    expect(pendingOwnerSettlementSession(selected, identity).hash).toBe(durable!.hash);
    expect(retainedPendingOwnerSession(selected, identity, order()).wallet).toBe(wallet);
    expect(() => capturePostgresPendingOwnerAdmission(selected, identity, order())).toThrow("session_unavailable");
    fixture.manifest = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "postgres", database: "offline_fixture" } };
    const native = await proof(); expect(() => pendingOwnerSettlementSession(native, identity)).toThrow("session_unavailable");
  });
  it("binds all nine logical identity fields and the selected deployment", async () => {
    const selected = await proof();
    for (const key of Object.keys(identity) as (keyof StorageIdentity)[]) {
      const changed = { ...identity, [key]: key === "enrolledAt" ? "2026-10-02T00:00:00.000Z" : key.endsWith("Id") ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" : "changed" };
      expect(() => capturePostgresPendingOwnerSession(selected, changed as StorageIdentity, "admit")).toThrow();
    }
    fixture.manifest = { ...(fixture.manifest as object), backend: { kind: "postgres", database: "other_fixture" } };
    expect(() => capturePostgresPendingOwnerSession(selected, identity, "admit")).toThrow("session_unavailable");
  });
  it.each(["id", "queryId", "requestHash", "createdAt", "network"])("rejects changed exact original %s", async field => {
    const selected = await proof(), original = order();
    const changed = field === "network" ? { ...original, request: { ...original.request!, network: "eip155:5042002" } }
      : { ...original, [field]: field === "createdAt" ? new Date(now + 1).toISOString() : field === "requestHash" ? "b".repeat(64) : `a2a_${"b".repeat(64)}` };
    expect(() => capturePostgresPendingOwnerAdmission(selected, identity, changed)).toThrow("session_unavailable");
  });
  it("expires within five minutes and also at the original JWT expiry", async () => {
    const selected = await proof(); vi.setSystemTime(now + 299999);
    expect(capturePostgresPendingOwnerSession(selected, identity, "admit").proofExpiresAt).toBe(now + 300000);
    vi.setSystemTime(now + 300000); expect(() => capturePostgresPendingOwnerSession(selected, identity, "admit")).toThrow("session_unavailable");
    vi.setSystemTime(now); fixture.token = (await issueWebSession(db as unknown as KeryxDB, "offline-fixture-secret-with-no-authority", wallet, "asker", new Date(now + 60000).toISOString())).token;
    const short = await proof(); expect(capturePostgresPendingOwnerSession(short, identity, "admit").proofExpiresAt).toBe(now + 60000);
    vi.setSystemTime(now + 60000); expect(() => capturePostgresPendingOwnerSession(short, identity, "admit")).toThrow("session_unavailable");
  });
});

describe("fixed native pending owner observations", () => {
  it("requires an awaited fresh observation and consumes its one-use final synchronous marker", async () => {
    const selected = await proof(), { port, call } = channelFixture();
    expect(() => port.assertAdmission(selected)).toThrow("owner_association_unavailable");
    await port.assertAdmissionAsync!(selected); expect(port.assertAdmission(selected)).toBeUndefined();
    expect(() => port.assertAdmission(selected)).toThrow("owner_association_unavailable");
    expect(call).toHaveBeenCalledTimes(1); expect(call.mock.calls[0][0]).toBe("pendingOwnerAdmission");
    const packet = JSON.parse(call.mock.calls[0][1][0]!);
    expect(packet.session).toEqual(durable); expect(canonicalJson(packet.identity)).toBe(canonicalJson(identity));
  });
  it("refuses read-only admission before any native call", async () => {
    const selected = await proof(), { channel, call } = channelFixture(), port = composePostgresPendingJobOwners(channel, identity, true);
    expect(() => port.assertAdmission(selected)).toThrow("owner_association_unavailable");
    await expect(port.assertAdmissionAsync!(selected)).rejects.toThrow("owner_association_unavailable"); expect(call).not.toHaveBeenCalled();
  });
  it("contains revoked-session observations and never retries a rejected query", async () => {
    const selected = await proof(), { port, call } = channelFixture(); call.mockRejectedValue(new Error("revoked durable session"));
    await expect(port.assertAdmissionAsync!(selected)).rejects.toThrow("revoked durable session");
    expect(() => port.assertAdmission(selected)).toThrow("owner_association_unavailable"); expect(call).toHaveBeenCalledTimes(1);
  });
  it.each(["expiry", "disposal", "configuration"])("refuses %s changed during a native await", async kind => {
    const selected = await proof(), { port, channel, call } = channelFixture();
    let finish!: (value: unknown) => void; call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = port.assertAdmissionAsync!(selected), outcome = expect(pending).rejects.toThrow();
    if (kind === "expiry") vi.setSystemTime(now + 300000);
    else if (kind === "disposal") await channel.close();
    else fixture.manifest = { ...(fixture.manifest as object), backend: { kind: "postgres", database: "changed" } };
    finish(true); await outcome; expect(() => port.assertAdmission(selected)).toThrow(); expect(call).toHaveBeenCalledTimes(1);
  });
  it("captures list selectors before awaits and exposes no worker input or payer", async () => {
    const selected = await proof(true), { port, call } = channelFixture(), original = order();
    const before = { createdAt: new Date(now + 1000).toISOString(), id: original.id };
    const row = { id: original.id, query_id: original.id, status: "failed", created_at: original.createdAt, updated_at: original.updatedAt,
      started_at: null, amount_usdc: .05, creator_budget_usdc: .03, service_fee_usdc: .02, research_mode: "quick", package_data: null,
      transaction_id: "", execution_journal_version: 1, payment_started_at: null, result_saving_at: null, error_code: "research_failed", worker_id: null, payee: original.payee };
    call.mockResolvedValue({ rows: [row], recovery: null, observedAtMs: now });
    const pending = port.list(selected, before, original.id); before.createdAt = "mutated";
    const jobs = await pending; expect(jobs).toHaveLength(1); expect(jobs[0].attention).toBe("needs_review");
    expect(jobs[0].recoveryState).toBe("unknown"); expect(jobs[0].question).toBeNull();
    expect(JSON.stringify(jobs)).not.toContain("payer"); expect(call.mock.calls[0][0]).toBe("pendingOwnerList");
    expect(JSON.parse(call.mock.calls[0][1][1]!).createdAt).toBe(new Date(now + 1000).toISOString());
    expect(fixture.nativeIdentity).toHaveBeenCalledWith(db, "read");
  });
  it("rejects malformed or oversized metadata and forged readers without fallback", async () => {
    const selected = await proof(true), { port, call } = channelFixture();
    call.mockResolvedValue({ rows: Array(27).fill({}), recovery: null, observedAtMs: now });
    await expect(port.list(selected)).rejects.toThrow();
    await expect(port.list({} as PendingOwnerSessionProof)).rejects.toThrow("session_unavailable"); expect(call).toHaveBeenCalledTimes(1);
    expect(webSessionHash("unknown")).not.toBe(durable!.hash);
  });
});
