import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../storage-identity";
import type { SessionGrantConsent } from "../../payments/session-grant-consent";
const state = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), on: vi.fn(), configurations: [] as unknown[] }));
vi.mock("pg", () => ({ Pool: class {
  constructor(options: unknown) { state.configurations.push(options); }
  query(...args: unknown[]) { return state.query(...args); }
  end() { return state.end(); }
  on(...args: unknown[]) { state.on(...args); }
}, types: { getTypeParser: () => (value: string) => value } }));
import { createPostgresConsentTransport, PostgresConsentWriteOutcomeUnknown } from "./consent-transport";
import { PostgresStorageBusy, PostgresStorageUnavailable } from "./connection";
const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", network: "eip155:5042", authorityMode: "mainnet-real",
  deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: "2026-11-12T00:00:00.000Z",
  profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, provenanceDigest: "11".repeat(32) };
const options = { endpoint: { kind: "loopback" as const, port: 5432 }, database: "synthetic", role: "keryx_app", password: "synthetic-not-a-live-secret" };
const digest = "22".repeat(32), sig = `0x${"33".repeat(65)}`;
const consent: SessionGrantConsent = { format: "keryx-session-grant-consent-v1", network: "eip155:5042", origin: "https://keryx.cc",
  ownerAddr: `0x${"11".repeat(20)}`, sessAddr: `0x${"22".repeat(20)}`, grantEpoch: randomUUID(), capMicroUsdc: "10", expirySeconds: "2000000000" };
const response = (wire: string | null) => ({ rows: [[wire]], fields: [{ name: "result", dataTypeID: 3802 }] });
beforeEach(() => { vi.clearAllMocks(); state.configurations.length = 0; state.query.mockResolvedValue(response(null)); state.end.mockResolvedValue(undefined); });

describe("closed PostgreSQL consent transport", () => {
  it("binds expected identity, source contract and canonical original to fixed writes", async () => {
    const transport = createPostgresConsentTransport(options, identity, digest);
    await transport.issue(consent); await transport.consume(consent, sig, sig);
    const issue = state.query.mock.calls[0][0], consume = state.query.mock.calls[1][0];
    expect(issue.text).toBe("SELECT public.storage_issue_session_grant_consent($1::jsonb,$2::text,$3::text) AS result");
    expect(JSON.parse(issue.values[0])).toEqual(identity); expect(issue.values[1]).toBe(digest); expect(JSON.parse(issue.values[2])).toEqual(consent);
    expect(consume.text).toContain("storage_consume_session_grant_consent"); expect(consume.values.slice(-2)).toEqual([sig, sig]);
    expect(Object.keys(transport).sort()).toEqual(["close", "consume", "get", "issue"]); await transport.close();
  });
  it("returns only the exact original owner proof and distinguishes absence", async () => {
    const transport = createPostgresConsentTransport(options, identity, digest);
    expect(await transport.get(consent.ownerAddr, consent.grantEpoch)).toBeNull();
    const proof = { consent, ownerSignature: sig, sessionSignature: sig }; state.query.mockResolvedValue(response(JSON.stringify(proof)));
    expect(await transport.get(consent.ownerAddr, consent.grantEpoch)).toEqual(proof); await transport.close();
  });
  it("rejects foreign identity/invalid contract and invalid requests before SQL", async () => {
    expect(() => createPostgresConsentTransport(options, { ...identity, network: "eip155:1" } as never, digest)).toThrow();
    expect(() => createPostgresConsentTransport(options, identity, "invalid")).toThrow(); expect(state.configurations).toHaveLength(0);
    const transport = createPostgresConsentTransport(options, identity, digest);
    await expect(transport.issue({ ...consent, network: "eip155:5042002" })).rejects.toThrow();
    await expect(transport.consume(consent, "invalid", sig)).rejects.toThrow(PostgresStorageUnavailable);
    await expect(transport.get("foreign", consent.grantEpoch)).rejects.toThrow(PostgresStorageUnavailable);
    expect(state.query).not.toHaveBeenCalled(); await transport.close();
  });
  it("treats lost write acknowledgement as unknown, redacts errors and never retries", async () => {
    const transport = createPostgresConsentTransport(options, identity, digest);
    state.query.mockRejectedValue(new Error("private database detail and credential"));
    await expect(transport.consume(consent, sig, sig)).rejects.toThrow(PostgresConsentWriteOutcomeUnknown);
    expect(state.query).toHaveBeenCalledTimes(1);
    await expect(transport.get(consent.ownerAddr, consent.grantEpoch)).rejects.toThrow(/^PostgreSQL storage unavailable$/);
    expect(state.query).toHaveBeenCalledTimes(2); await transport.close();
  });
  it("does not accept malformed write acknowledgements", async () => {
    const transport = createPostgresConsentTransport(options, identity, digest);
    state.query.mockResolvedValue(response('{"ok":true}'));
    await expect(transport.issue(consent)).rejects.toThrow(PostgresConsentWriteOutcomeUnknown); await transport.close();
  });
  it.each([
    null, {}, [], { consent, ownerSignature: sig }, { consent: { ...consent, ownerAddr: `0x${"99".repeat(20)}` }, ownerSignature: sig, sessionSignature: sig },
    { consent: { ...consent, grantEpoch: randomUUID() }, ownerSignature: sig, sessionSignature: sig },
    { consent, ownerSignature: "invalid", sessionSignature: sig }, { consent, ownerSignature: sig, sessionSignature: sig, extra: true },
  ].map(value => ({ value })))("refuses malformed or foreign proofs: $value", async ({ value }) => {
    const transport = createPostgresConsentTransport(options, identity, digest); state.query.mockResolvedValue(response(JSON.stringify(value)));
    await expect(transport.get(consent.ownerAddr, consent.grantEpoch)).rejects.toThrow(PostgresStorageUnavailable); await transport.close();
  });
  it("refuses oversized wire before parsing", async () => {
    const transport = createPostgresConsentTransport(options, identity, digest); state.query.mockResolvedValue(response('"' + "x".repeat(16384) + '"'));
    await expect(transport.get(consent.ownerAddr, consent.grantEpoch)).rejects.toThrow(PostgresStorageUnavailable); await transport.close();
  });
  it("bounds mixed requests and marks already admitted writes unknown after terminal close", async () => {
    let finish!: (value: unknown) => void;
    state.query.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const transport = createPostgresConsentTransport(options, identity, digest);
    const requests = Array.from({ length: 10 }, () => transport.issue(consent));
    const outcomes = Promise.allSettled(requests);
    await expect(transport.issue(consent)).rejects.toThrow(PostgresStorageBusy);
    expect(state.query).toHaveBeenCalledTimes(10);
    const closing = transport.close(); expect(transport.close()).toBe(closing); expect(state.end).not.toHaveBeenCalled();
    finish(response(null));
    for (const result of await outcomes) { expect(result.status).toBe("rejected"); if (result.status === "rejected") expect(result.reason).toBeInstanceOf(PostgresConsentWriteOutcomeUnknown); }
    await closing; await expect(transport.issue(consent)).rejects.toThrow(PostgresStorageUnavailable); expect(state.query).toHaveBeenCalledTimes(10);
    expect(state.end).toHaveBeenCalledTimes(1);
  });
  it.each(["read", "write"])("rechecks disposal across the outer %s await boundary", async kind => {
    let finish!: (value: unknown) => void;
    state.query.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const transport = createPostgresConsentTransport(options, identity, digest);
    const request = kind === "read" ? transport.get(consent.ownerAddr, consent.grantEpoch) : transport.issue(consent);
    const outcome = expect(request).rejects.toThrow(kind === "read" ? PostgresStorageUnavailable : PostgresConsentWriteOutcomeUnknown);
    finish(response(null));
    let closing: Promise<void> | undefined;
    queueMicrotask(() => { closing = transport.close(); });
    await outcome; await closing; expect(state.end).toHaveBeenCalledTimes(1);
  });
});
