import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import { claimRun, prepareRunClaimDelivery, runClaimTokenHash } from "./service";
import { requireRunClaims, RUN_CLAIM_TTL_MS, runClaimBindingSchema, runClaimDeliverySchema, runClaimsEnabled,
  type RunClaimBinding, type RunClaimIssue, type RunClaimsStore } from "./contracts";

const now = Date.parse("2026-10-11T00:00:00.000Z"), wallet = `0x${"a".repeat(40)}`;
const binding: RunClaimBinding = { network: "eip155:5042002", origin: "https://synthetic-claims.example" };
const run = (id = "new-run", extra: Partial<QueryRun> = {}): QueryRun => ({ id, question: "Synthetic claim fixture", budget: 0,
  engine: "heuristic", subClaims: [], decisions: [], citations: [], answer: "Synthetic answer", totalSpent: 0,
  totalToCreators: 0, trace: [], createdAt: new Date(now).toISOString(), paymentMode: "offline", ...extra });
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const issue = vi.fn(async (input: RunClaimIssue) => ({ version: 1 as const, runId: input.runId, binding: input.binding,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + RUN_CLAIM_TTL_MS).toISOString() }));
  const claim = vi.fn(async () => ({ version: 1 as const, runId: "new-run", wallet, claimedAt: new Date(now).toISOString(), binding }));
  const assertAvailable = vi.fn(async () => {});
  const store: RunClaimsStore = { issue, claim, assertAvailable };
  return { db: { runClaims: store }, issue, claim, assertAvailable };
}
afterEach(() => { vi.useRealTimers(); });
describe("caller-local anonymous run claim delivery", () => {
  it("mints only on new completion, stores hashes only and leaves the original untouched", async () => {
    const f = fixture(), delivery = await prepareRunClaimDelivery(f.db, binding, "new-run");
    expect(f.issue).not.toHaveBeenCalled(); expect(f.assertAvailable).toHaveBeenCalledOnce();
    const original = run(), before = JSON.stringify(original), result = await delivery.complete(original);
    expect(JSON.stringify(original)).toBe(before); expect(result).not.toBeNull();
    const url = new URL(result!.claimUrl), token = url.hash.slice(1);
    expect(token).toMatch(/^[a-f0-9]{64}$/); expect(url.pathname).toBe("/claim-run"); expect(url.search).toBe("");
    expect(result!.expiresAt).toBe(new Date(now + RUN_CLAIM_TTL_MS).toISOString());
    expect(f.issue).toHaveBeenCalledWith({ runId: original.id, completedAt: original.createdAt, binding, tokenHash: runClaimTokenHash(token, binding) });
    expect(JSON.stringify(f.issue.mock.calls)).not.toContain(token); expect(JSON.stringify(original)).not.toContain(token);
    await expect(delivery.complete(original)).rejects.toThrow("claim_unavailable"); expect(f.issue).toHaveBeenCalledOnce();
  });
  it("uses independent 256-bit tokens and domain-binds their hashes", async () => {
    const f = fixture(), one = await prepareRunClaimDelivery(f.db, binding, "one"), two = await prepareRunClaimDelivery(f.db, binding, "two");
    const a = (await one.complete(run("one")))!, b = (await two.complete(run("two")))!;
    expect(a.claimUrl).not.toBe(b.claimUrl); const token = new URL(a.claimUrl).hash.slice(1);
    expect(runClaimTokenHash(token, binding)).not.toBe(runClaimTokenHash(token, { ...binding, network: "eip155:5042" }));
    expect(runClaimTokenHash(token, binding)).not.toBe(runClaimTokenHash(token, { ...binding, origin: "https://other.example" }));
  });
  it.each([{ asker: wallet }, { asker: undefined }, { originalFulfillment: undefined }, { askerFunded: true }, { fundingOwner: "browser" as const }])
    ("omits tickets for ownership/original/browser-funding markers", async extra => {
      const f = fixture(), delivery = await prepareRunClaimDelivery(f.db, binding, "new-run");
      expect(await delivery.complete(run("new-run", extra))).toBeNull(); expect(f.issue).not.toHaveBeenCalled();
    });
  it.each([run("other"), run("new-run", { createdAt: new Date(now - 1).toISOString() }), run("new-run", { createdAt: "bad" }),
    run("new-run", { createdAt: new Date(now + 1).toISOString() })])("refuses mismatched/historical/future completion without minting", async original => {
    const f = fixture(), delivery = await prepareRunClaimDelivery(f.db, binding, "new-run");
    await expect(delivery.complete(original)).rejects.toThrow("claim_unavailable"); expect(f.issue).not.toHaveBeenCalled();
  });
  it("an issuance outage is terminal: no repeat or regenerated lost response", async () => {
    const f = fixture(); f.issue.mockRejectedValue(new Error("untrusted backend body"));
    const delivery = await prepareRunClaimDelivery(f.db, binding, "new-run");
    await expect(delivery.complete(run())).rejects.toThrow("claims_unavailable");
    await expect(delivery.complete(run())).rejects.toThrow("claim_unavailable"); expect(f.issue).toHaveBeenCalledOnce();
  });
  it("unsupported storage and readiness refuse before minting or research", async () => {
    const f = fixture(); await expect(prepareRunClaimDelivery({}, binding, "new-run")).rejects.toThrow("claims_unavailable");
    expect(() => requireRunClaims({ get runClaims(): RunClaimsStore { throw new Error("sealed"); } })).toThrow("claims_unavailable");
    f.assertAvailable.mockRejectedValue(new Error("untrusted readiness body"));
    await expect(prepareRunClaimDelivery(f.db, binding, "new-run")).rejects.toThrow(/^claims_unavailable$/); expect(f.issue).not.toHaveBeenCalled();
    expect(runClaimsEnabled({})).toBe(false); for (const value of ["1", "TRUE", "false", " true "]) expect(runClaimsEnabled({ KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED: value })).toBe(false);
    expect(runClaimsEnabled({ KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED: "true" })).toBe(true);
  });
  it("hashes before consuming, binds the authenticated wallet and never echoes tokens in errors", async () => {
    const f = fixture(), token = "c".repeat(64), authority = { wallet, sessionHash: "d".repeat(64) };
    expect(await claimRun(f.db, token, authority, binding)).toMatchObject({ wallet, runId: "new-run" });
    expect(f.claim).toHaveBeenCalledWith({ ...authority, binding, tokenHash: runClaimTokenHash(token, binding) });
    expect(JSON.stringify(f.claim.mock.calls)).not.toContain(token);
    f.claim.mockRejectedValue(new Error(`provider echoed ${token}`));
    await expect(claimRun(f.db, token, authority, binding)).rejects.toThrow(/^claims_unavailable$/);
  });
  it.each(["", "C".repeat(64), "a".repeat(63), "a".repeat(65), `?token=${"a".repeat(64)}`])("malformed tokens refuse before storage", async token => {
    const f = fixture(); await expect(claimRun(f.db, token, { wallet, sessionHash: "d".repeat(64) }, binding)).rejects.toThrow(/^claim_unavailable$/);
    expect(f.claim).not.toHaveBeenCalled();
  });
  it("forwards only validated SIWE wallet/session fields, without unrelated caller secrets", async () => {
    const f = fixture(), token = "a".repeat(64), authority = { wallet, sessionHash: "d".repeat(64), unrelatedSecret: "caller-only-secret" };
    await claimRun(f.db, token, authority, binding);
    expect(f.claim).toHaveBeenCalledWith({ wallet, sessionHash: authority.sessionHash, tokenHash: runClaimTokenHash(token, binding), binding });
    expect(JSON.stringify(f.claim.mock.calls)).not.toContain(authority.unrelatedSecret);
    f.claim.mockClear();
    for (const bad of [{ wallet: "invalid", sessionHash: authority.sessionHash }, { wallet, sessionHash: "invalid" }])
      await expect(claimRun(f.db, token, bad, binding)).rejects.toThrow(/^claim_unavailable$/);
    expect(f.claim).not.toHaveBeenCalled();
  });
  it("strict delivery/binding contracts reject secret-bearing selectors or foreign URLs", () => {
    for (const origin of ["https://secret@synthetic.example", "https://synthetic.example/", "https://synthetic.example/path", "http://remote.example", "https://synthetic.example?token=secret"])
      expect(runClaimBindingSchema.safeParse({ ...binding, origin }).success).toBe(false);
    for (const claimUrl of [`https://foreign.example/report#${"a".repeat(64)}`, `https://synthetic.example/claim-run?token=${"a".repeat(64)}`,
      `javascript:secret`, `https://secret@synthetic.example/claim-run#${"a".repeat(64)}`])
      expect(runClaimDeliverySchema.safeParse({ version: 1, claimUrl, expiresAt: new Date(now + RUN_CLAIM_TTL_MS).toISOString() }).success).toBe(false);
  });
  it("defines one canonical ASCII DNS/loopback origin subset for ordinary JS and SQL", () => {
    for (const origin of ["https://claims.example", "https://one-two.claims.example:8443", "https://localhost", "http://localhost:3939",
      "http://127.0.0.1", "https://127.0.0.1:3939", "http://[::1]:3939", "https://[::1]"])
      expect(runClaimBindingSchema.safeParse({ ...binding, origin }).success).toBe(true);
    for (const origin of ["http://remote.example", "https://remote.example:443", "http://localhost:80", "https://remote.example:0",
      "https://remote.example:08443", "https://REMOTE.example", "https://remote.example.", "https://8.8.8.8", "https://127.1",
      "https://xn--bcher-kva.example", "https://b\u00fccher.example", "https://under_score.example", "https://-label.example"])
      expect(runClaimBindingSchema.safeParse({ ...binding, origin }).success).toBe(false);
  });
});
