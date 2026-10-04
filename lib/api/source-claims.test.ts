import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), getSession: vi.fn(), readRegistry: vi.fn(), fetchDocument: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("../registry/registry-client", async importOriginal => ({ ...await importOriginal<typeof import("../registry/registry-client")>(), getRegistrySource: mocks.readRegistry }));
vi.mock("../net/public-fetch", () => ({ fetchPublicDocument: mocks.fetchDocument }));
import { POST as issue } from "../../app/api/source-claims/challenge/route";
import { POST as verify } from "../../app/api/source-claims/verify/route";
import { POST as link } from "../../app/api/source-claims/[id]/link/route";
import { POST as policy } from "../../app/api/source-claims/[id]/policy/route";
import { GET as read } from "../../app/api/source-claims/route";
import { config } from "../config";
import { sourceId } from "../registry/registry-client";
import { issueSqliteSourceClaimChallenge, getSqliteSourceClaim, getSqliteSourceClaimChallenge, reserveSqliteSourceClaimVerification,
  verifySqliteSourceClaim, getSqliteSourceClaimForSource, bindSqliteSourceClaim, updateSqliteSourceClaimPolicy, listSqliteSourceClaims } from "../db/public-source-claims";
import { sourceClaimProof, type SourceClaim } from "../sources/public-source-claim";
import { sourceClaimPolicyForSource, reserveSourceClaimRegistration } from "../sources/public-source-claim-service";
import type { KeryxDB } from "../db/keryx-db";
import type { Source } from "../types";

const wallet = "0x1111111111111111111111111111111111111111", other = "0x2222222222222222222222222222222222222222";
const canonicalUrl = "https://publisher.example/", rssUrl = "https://publisher.example/rss";
const registry = "0x8888888888888888888888888888888888888888", onchainId = sourceId(wallet, canonicalUrl);
const oldConfig = { baseUrl: config.baseUrl, registryAddress: config.registryAddress, registryReadAddress: config.registryReadAddress };
let native: DatabaseSync, db: KeryxDB, source: Source;
function request(path: string, body?: unknown, origin = "https://keryx.cc") {
  return new Request(`https://keryx.cc/api/source-claims${path}`, body === undefined ? {} : {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  Object.assign(config, { baseUrl: "https://keryx.cc", registryAddress: registry, registryReadAddress: registry });
  native = new DatabaseSync(":memory:"); native.exec("CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)");
  source = { id: "owned", onchainId, url: canonicalUrl, rssUrl, name: "Publisher", description: "Feed", walletAddress: wallet,
    authors: [{ name: "Publisher", walletAddress: wallet, splitWeight: 1 }], fetchPrice: 0, tags: [], verified: true, active: true, createdAt: new Date().toISOString() };
  const fixture: Partial<KeryxDB> = {
    issueSourceClaimChallenge: async input => issueSqliteSourceClaimChallenge(native, input),
    getSourceClaim: async id => getSqliteSourceClaim(native, id),
    getSourceClaimChallenge: async id => getSqliteSourceClaimChallenge(native, id),
    reserveSourceClaimVerification: async (id, owner, now) => reserveSqliteSourceClaimVerification(native, id, owner, now),
    verifySourceClaim: async input => verifySqliteSourceClaim(native, input),
    getSourceClaimForSource: async id => getSqliteSourceClaimForSource(native, id),
    bindSourceClaim: async input => bindSqliteSourceClaim(native, input),
    updateSourceClaimPolicy: async input => updateSqliteSourceClaimPolicy(native, input),
    listSourceClaims: async owner => listSqliteSourceClaims(native, owner),
    getSource: async id => id === source.id ? source : null,
    verifySourceIfUnchanged: async input => {
      if (input.sourceId !== source.id || input.walletAddress !== source.walletAddress || input.feedUrl !== source.rssUrl) return false;
      source.verified = true; return true;
    },
    getPublicReference: async () => ({ id: "public:publisher", url: canonicalUrl, rssUrl } as never),
  };
  db = fixture as KeryxDB;
  mocks.getDb.mockReset().mockResolvedValue(db); mocks.getSession.mockReset().mockResolvedValue({ address: wallet });
  mocks.readRegistry.mockReset().mockResolvedValue({ creator: wallet, payoutWallet: wallet, active: true, fetchPriceUsdc6: BigInt(0), authors: [{ wallet, basisPoints: 10000 }] });
  mocks.fetchDocument.mockReset();
});
afterEach(() => { native.close(); Object.assign(config, oldConfig); vi.restoreAllMocks(); });
async function createClaim(): Promise<SourceClaim> {
  const issued = await issue(request("/challenge", { canonicalUrl, rssUrl }));
  expect(issued.status).toBe(200);
  const data = await issued.json();
  mocks.fetchDocument.mockResolvedValue({ text: JSON.stringify(data.proof), finalUrl: data.proofUrl, contentType: "application/json" });
  const result = await verify(request("/verify", { challengeId: data.challenge.id })); expect(result.status).toBe(200);
  return (await result.json()).claim;
}
describe("source claim HTTP authority", () => {
  it("runs challenge → exact public proof → verified free → registry link → explicit citation-only", async () => {
    const claim = await createClaim(); expect(claim.mode).toBe("free");
    const linkedResponse = await link(request(`/${claim.id}/link`, { sourceId: source.id, expectedRevision: claim.revision }), { params: Promise.resolve({ id: claim.id }) });
    const linked = (await linkedResponse.json()).claim; expect(linkedResponse.status).toBe(200); expect(linked.mode).toBe("free");
    const activatedResponse = await policy(request(`/${claim.id}/policy`, { mode: "citation-only", distributionPermission: true, expectedRevision: linked.revision }), { params: Promise.resolve({ id: claim.id }) });
    expect(activatedResponse.status).toBe(200);
    const active = (await activatedResponse.json()).claim;
    expect(active).toMatchObject({ mode: "citation-only", linkedSourceId: source.id, revision: 3 });
    expect(await sourceClaimPolicyForSource(db, source.id)).toEqual(active);
    mocks.getSession.mockResolvedValue(null);
    const publicRead = await read(request(`?claimId=${claim.id}`));
    expect(publicRead.status).toBe(200); expect((await publicRead.json()).claim.nonce).toBeUndefined();
  });
  it("resumes original owner challenge without reissuing it, and prevents unauthenticated nonce disclosure", async () => {
    const response = await issue(request("/challenge", { canonicalUrl, rssUrl })); const data = await response.json();
    const resumed = await read(request(`?challengeId=${data.challenge.id}`));
    expect((await resumed.json()).proof).toEqual(sourceClaimProof(data.challenge));
    mocks.getSession.mockResolvedValue(null);
    expect((await read(request(`?challengeId=${data.challenge.id}`))).status).toBe(401);
    expect((await read(request(""))).status).toBe(401);
  });
  it("refuses CSRF, malformed/oversized bodies, unsupported storage and substituted catalog identities", async () => {
    expect((await issue(request("/challenge", { canonicalUrl }, "https://attacker.example"))).status).toBe(403);
    expect((await issue(new Request("https://keryx.cc/api/source-claims/challenge", { method: "POST", headers: { Origin: "https://keryx.cc" }, body: "{" }))).status).toBe(400);
    expect((await issue(request("/challenge", { canonicalUrl, junk: "x".repeat(9000) }))).status).toBe(413);
    expect((await issue(request("/challenge", { canonicalUrl, rssUrl: "https://publisher.example/wrong", publicReferenceId: "public:publisher" }))).status).toBe(409);
    mocks.getDb.mockResolvedValue({}); expect((await issue(request("/challenge", { canonicalUrl }))).status).toBe(503);
    expect(mocks.fetchDocument).not.toHaveBeenCalled();
  });
  it("rejects expired proof before fetch and refuses copied wallet proof without consuming ownership", async () => {
    const expired = await db.issueSourceClaimChallenge!({ wallet, canonicalUrl, deploymentOrigin: "https://keryx.cc", network: config.networkId, now: 1 });
    expect((await verify(request("/verify", { challengeId: expired.id }))).status).toBe(409);
    expect(mocks.fetchDocument).not.toHaveBeenCalled();
    const issued = await issue(request("/challenge", { canonicalUrl })), data = await issued.json();
    mocks.fetchDocument.mockResolvedValue({ text: JSON.stringify({ ...data.proof, wallet: other }), finalUrl: data.proofUrl });
    expect((await verify(request("/verify", { challengeId: data.challenge.id }))).status).toBe(409);
    expect(await db.getSourceClaim!(data.challenge.claimId)).toBeNull();
  });
  it("reserves the earning gate before registration and refuses cross-source or cross-wallet reuse", async () => {
    const claim = await createClaim();
    const reserved = await reserveSourceClaimRegistration(db, { claimId: claim.id, wallet, canonicalUrl, sourceId: source.id, onchainId });
    expect(reserved.mode).toBe("free"); expect((await db.getSourceClaimForSource!(source.id))?.id).toBe(claim.id);
    await expect(reserveSourceClaimRegistration(db, { claimId: claim.id, wallet: other, canonicalUrl, sourceId: source.id, onchainId })).rejects.toThrow("owner wallet");
    await expect(reserveSourceClaimRegistration(db, { claimId: claim.id, wallet, canonicalUrl: "https://victim.example/", sourceId: "victim", onchainId })).rejects.toThrow("differs");
  });
  it("rejects wrong live registry creators, scholarly enrollment, mismatched fee modes and stale revisions", async () => {
    const claim = await createClaim(), ctx = { params: Promise.resolve({ id: claim.id }) };
    mocks.readRegistry.mockResolvedValue({ creator: other, active: true, fetchPriceUsdc6: BigInt(0) });
    expect((await link(request(`/${claim.id}/link`, { sourceId: source.id, expectedRevision: 1 }), ctx)).status).toBe(403);
    source.scholarlyEnrolled = true;
    expect((await link(request(`/${claim.id}/link`, { sourceId: source.id, expectedRevision: 1 }), ctx)).status).toBe(409);
    source.scholarlyEnrolled = false;
    mocks.readRegistry.mockResolvedValue({ creator: wallet, active: true, fetchPriceUsdc6: BigInt(0) });
    const linked = (await (await link(request(`/${claim.id}/link`, { sourceId: source.id, expectedRevision: 1 }), ctx)).json()).claim;
    expect((await policy(request(`/${claim.id}/policy`, { mode: "paid", expectedRevision: linked.revision, distributionPermission: true }), ctx)).status).toBe(409);
    expect((await policy(request(`/${claim.id}/policy`, { mode: "citation-only", expectedRevision: 1, distributionPermission: true }), ctx)).status).toBe(409);
    mocks.readRegistry.mockRejectedValue(new Error("RPC outage"));
    expect((await policy(request(`/${claim.id}/policy`, { mode: "citation-only", expectedRevision: linked.revision, distributionPermission: true }), ctx)).status).toBe(503);
    const disabled = await policy(request(`/${claim.id}/policy`, { mode: "free", expectedRevision: linked.revision }), ctx);
    expect(disabled.status).toBe(200); expect((await disabled.json()).claim.mode).toBe("free");
  });
  it("inherits the dedicated proof only after fresh live creator authority, preserving free policy", async () => {
    const claim = await createClaim(); source.verified = false;
    const result = await link(request(`/${claim.id}/link`, { sourceId: source.id, expectedRevision: claim.revision }), { params: Promise.resolve({ id: claim.id }) });
    expect(result.status).toBe(200); expect(source.verified).toBe(true);
    expect((await result.json()).claim.mode).toBe("free");
  });
});
