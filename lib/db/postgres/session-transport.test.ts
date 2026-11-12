import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../storage-identity";
const state = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), configurations: [] as unknown[] }));
vi.mock("pg", () => ({ Pool: class {
  constructor(options: unknown) { state.configurations.push(options); }
  query(...args: unknown[]) { return state.query(...args); }
  end() { return state.end(); }
  on() {}
}, types: { getTypeParser: () => (value: string) => value } }));
import { createPostgresSessionTransport } from "./session-transport";
import { PostgresStorageBusy, PostgresStorageUnavailable } from "./connection";
const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", network: "eip155:5042", authorityMode: "mainnet-real",
  deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: "2026-11-12T00:00:00.000Z",
  profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, provenanceDigest: "11".repeat(32) };
const options = { endpoint: { kind: "loopback" as const, port: 5432 }, database: "synthetic", role: "keryx_reader", password: "synthetic-not-a-live-secret" };
const digest = "22".repeat(32), signer = `0x${"ab".repeat(20)}`, after = "2026-11-12T00:00:00.000Z";
const totals = { hasAuthorityHistory: true, confirmedSpentMicroUsdc: "3", retainedSpentMicroUsdc: "7", postBaselineConfirmedDebitMicroUsdc: "2" };
const response = (value: unknown) => ({ rows: [[JSON.stringify(value)]], fields: [{ name: "result", dataTypeID: 3802 }] });
beforeEach(() => { vi.clearAllMocks(); state.configurations.length = 0; state.end.mockResolvedValue(undefined); });
describe("composed native session accounting", () => {
  it("uses fixed calls and only one pool for both domain ports", async () => {
    const t = createPostgresSessionTransport(options, identity, digest);
    state.query.mockResolvedValue(response(totals)); expect(await t.sessionFundingAccounting(signer, after)).toEqual(totals);
    const call = state.query.mock.calls[0][0]; expect(call.text).toBe("SELECT public.storage_session_funding_accounting($1::jsonb,$2::text,$3::text,$4::text) AS result");
    expect(JSON.parse(call.values[0])).toEqual(identity); expect(call.values.slice(1)).toEqual([digest, signer, after]);
    state.query.mockResolvedValue(response(7)); expect(await t.browserSignerRetainedSpend(signer.toUpperCase().replace("0X", "0x"))).toBe(7);
    expect(state.query.mock.calls[1][0].values.slice(2)).toEqual([signer]);
    expect(state.configurations).toHaveLength(1); expect(Object.keys(t).sort()).toEqual(["browserSignerRetainedSpend", "close", "consume", "get", "issue", "sessionFundingAccounting"]); await t.close();
  });
  it("validates selectors and dates before dispatch", async () => {
    const t = createPostgresSessionTransport(options, identity, digest);
    for (const date of ["invalid", "2026-11-12", "2026-02-30T00:00:00.000Z", "2026-11-12T00:00:00.000+00:00"])
      await expect(t.sessionFundingAccounting(signer, date)).rejects.toThrow(PostgresStorageUnavailable);
    await expect(t.sessionFundingAccounting(signer.toUpperCase(), after)).rejects.toThrow(PostgresStorageUnavailable);
    await expect(t.browserSignerRetainedSpend("invalid")).rejects.toThrow(PostgresStorageUnavailable);
    expect(state.query).not.toHaveBeenCalled(); await t.close();
  });
  it.each([
    null, [], {}, { ...totals, extra: true }, { ...totals, retainedSpentMicroUsdc: 7 },
    { ...totals, retainedSpentMicroUsdc: "9007199254740992" }, { ...totals, confirmedSpentMicroUsdc: "8" },
    { ...totals, postBaselineConfirmedDebitMicroUsdc: "4" }, { ...totals, hasAuthorityHistory: false },
    { ...totals, confirmedSpentMicroUsdc: "03" },
  ].map(value => ({ value })))("refuses invalid financial totals: $value", async ({ value }) => {
    const t = createPostgresSessionTransport(options, identity, digest); state.query.mockResolvedValue(response(value));
    await expect(t.sessionFundingAccounting(signer, after)).rejects.toThrow(PostgresStorageUnavailable); await t.close();
  });
  it("never turns a backend failure into empty financial history or a retry", async () => {
    const t = createPostgresSessionTransport(options, identity, digest); state.query.mockRejectedValue(new Error("private connection info"));
    await expect(t.sessionFundingAccounting(signer)).rejects.toThrow(/^PostgreSQL storage unavailable$/);
    expect(state.query).toHaveBeenCalledTimes(1); await t.close();
  });
  it("bounds mixed domain requests through the shared queue and disposes all ports", async () => {
    let finish!: (value: unknown) => void; state.query.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const t = createPostgresSessionTransport(options, identity, digest);
    const outcomes = Promise.allSettled(Array.from({ length: 10 }, (_, i) => i % 2 ? t.browserSignerRetainedSpend(signer) : t.sessionFundingAccounting(signer)));
    await expect(t.get(signer, randomUUID())).rejects.toThrow(PostgresStorageBusy);
    const closing = t.close(); expect(state.end).not.toHaveBeenCalled(); finish(response(0));
    expect((await outcomes).every(r => r.status === "rejected")).toBe(true); await closing;
    await expect(t.browserSignerRetainedSpend(signer)).rejects.toThrow(PostgresStorageUnavailable); expect(state.query).toHaveBeenCalledTimes(10);
    expect(state.end).toHaveBeenCalledTimes(1);
  });
  it("refuses a baseline debit when there was no baseline", async () => {
    const t = createPostgresSessionTransport(options, identity, digest); state.query.mockResolvedValue(response(totals));
    await expect(t.sessionFundingAccounting(signer)).rejects.toThrow(PostgresStorageUnavailable); await t.close();
  });
  it.each(["read", "retained"])("suppresses late %s results across outer await", async kind => {
    let finish!: (value: unknown) => void; state.query.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const t = createPostgresSessionTransport(options, identity, digest);
    const request = kind === "read" ? t.sessionFundingAccounting(signer, after) : t.browserSignerRetainedSpend(signer);
    const outcome = expect(request).rejects.toThrow(PostgresStorageUnavailable); finish(response(kind === "read" ? totals : 7));
    let closing: Promise<void> | undefined; queueMicrotask(() => { closing = t.close(); }); await outcome; await closing;
  });
});
