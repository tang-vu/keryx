import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { KeryxDB } from "../db/keryx-db";
import { admitSqliteRegistrationSponsor, getSqliteRegistrationSponsor, transitionSqliteRegistrationSponsor } from "../db/registration-sponsor";
import { REGISTRY_ABI } from "../registry/registry-abi";
import { registrationId } from "./registration-status";
import { registrationTypedData, type RegistrationSponsorPolicy } from "./registration-sponsor-protocol";
import { prepareSponsoredRegistration, recoverSponsoredRegistration, submitSponsoredRegistration, type RegistrationSponsorContext } from "./registration-sponsor-service";
import { prepareSourceRegistration } from "./prepare-registration";
vi.mock("./prepare-registration", () => ({ prepareSourceRegistration: vi.fn() }));
const creator = privateKeyToAccount(`0x${"11".repeat(32)}`), sponsor = privateKeyToAccount(`0x${"22".repeat(32)}`);
const now = 1_800_000_000_000, canonicalUrl = "https://publisher.example/news", urlHash = keccak256(toBytes(canonicalUrl));
const registry = `0x${"33".repeat(20)}` as Hex, claimId = "ab".repeat(32), codeHash = keccak256("0x6000");
const connections: DatabaseSync[] = [];
afterEach(() => { connections.splice(0).forEach(db => db.close()); vi.clearAllMocks(); });
function fixture() {
  const native = new DatabaseSync(":memory:"); connections.push(native);
  native.exec("CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
  const policy: RegistrationSponsorPolicy = { protocol: "keryx-registration-sponsor-v1", network: "eip155:5042002", deploymentOrigin: "https://keryx.example",
    registryAddress: registry, registryCodeHash: codeHash, sponsorAddress: sponsor.address.toLowerCase() as Hex, expiresAt: now + 3_600_000,
    maxTransactionWei: "20000000000000000", maxDailyWei: "40000000000000000", maxLifetimeWei: "100000000000000000",
    maxGas: 400_000, maxFeePerGasWei: "50000000000", maxRegistrationsPerWallet: 3, maxRegistrationsPerDay: 5,
    maxRegistrationsTotal: 10, allowlistedCreators: [creator.address.toLowerCase() as Hex] };
  const onchainId = registrationId(creator.address, urlHash);
  const claim = { id: claimId, ownerWallet: creator.address.toLowerCase(), canonicalUrl, rssUrl: "https://publisher.example/feed.xml",
    network: policy.network, deploymentOrigin: policy.deploymentOrigin, registryAddress: registry,
    verifiedAt: new Date(now).toISOString(), effectiveAt: new Date(now).toISOString(), mode: "free" as const,
    distributionPermission: false, proofMethod: "website-file" as const, revision: 2, linkedSourceId: onchainId, onchainId };
  const syncClaim = () => native.prepare("INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES(?,?,?)")
    .run(`keryx:source-claims:v1:claim:${claim.id}`, JSON.stringify(claim), new Date(now).toISOString());
  syncClaim();
  const db = { getSourceClaim: vi.fn(async () => claim),
    admitRegistrationSponsor: async (...args: Parameters<typeof admitSqliteRegistrationSponsor> extends [DatabaseSync, ...infer R] ? R : never) => admitSqliteRegistrationSponsor(native, ...args),
    getRegistrationSponsor: async (input: Parameters<typeof getSqliteRegistrationSponsor>[1]) => getSqliteRegistrationSponsor(native, input),
    transitionRegistrationSponsor: async (input: Parameters<typeof transitionSqliteRegistrationSponsor>[1]) => transitionSqliteRegistrationSponsor(native, input) } as unknown as KeryxDB;
  vi.mocked(prepareSourceRegistration).mockResolvedValue({ status: 200, payload: { mode: "onchain", sourceId: onchainId,
    registerParams: { urlHash, payoutWallet: creator.address, authors: [{ wallet: creator.address, basisPoints: 10000 }], fetchPriceUsdc6: "16000", contentCid: "", tags: "software" } } });
  let clock = now, receipt: TransactionReceipt | null = null;
  const chain = { assertRegistry: vi.fn(async () => {}), registrationNonce: vi.fn(async () => BigInt(0)),
    transactionNonce: vi.fn(async () => 7), estimateGas: vi.fn(async () => BigInt(250000)),
    sign: vi.fn(sponsor.signTransaction.bind(sponsor)), broadcast: vi.fn(async (raw: Hex) => keccak256(raw)), receipt: vi.fn(async () => receipt) };
  const ctx: RegistrationSponsorContext = { db, policy, chain, assertPolicy: vi.fn(() => {}), now: () => clock };
  const prepare = () => prepareSponsoredRegistration(ctx, creator.address, { claimId, fetchPrice: 0.016 });
  const get = (id: Hex) => db.getRegistrationSponsor!({ wallet: creator.address, id });
  const makeReceipt = (hash: Hex, status: "success" | "reverted" = "success") => ({ transactionHash: hash, from: sponsor.address,
    to: registry, status, gasUsed: BigInt(250000), effectiveGasPrice: BigInt(20000000000),
    logs: status === "success" ? [{ address: registry, topics: encodeEventTopics({ abi: REGISTRY_ABI, eventName: "SourceRegistered",
      args: { id: onchainId, creator: creator.address } }), data: encodeAbiParameters([{ type: "string" }], [""]) }] : [] } as unknown as TransactionReceipt);
  return { ctx, db, native, chain, claim, syncClaim, prepare, get, makeReceipt, setClock: (value: number) => { clock = value; }, setReceipt: (value: TransactionReceipt) => { receipt = value; } };
}
describe("sponsored source registration service", () => {
  it("returns the same original on reload without preparing content or refreshing price/signature", async () => {
    const f = fixture(), row = await f.prepare();
    f.setClock(now + 1000);
    expect(await prepareSponsoredRegistration(f.ctx, creator.address, { claimId, fetchPrice: 0.040 })).toEqual(row);
    expect(prepareSourceRegistration).toHaveBeenCalledTimes(1); expect(f.chain.sign).not.toHaveBeenCalled();
  });
  it("refuses sponsorship without publishing proof or atomic storage", async () => {
    const f = fixture(); f.claim.verifiedAt = new Date(now - 25 * 3600_000).toISOString();
    await expect(f.prepare()).rejects.toMatchObject({ code: "proof_stale" });
    f.claim.verifiedAt = new Date(now).toISOString(); delete f.db.admitRegistrationSponsor;
    await expect(f.prepare()).rejects.toMatchObject({ code: "sponsorship_unavailable" });
    expect(prepareSourceRegistration).not.toHaveBeenCalled();
  });
  it("refuses another wallet's valid cryptographic signature before sponsor signing", async () => {
    const f = fixture(), row = await f.prepare(), signature = await sponsor.signTypedData(registrationTypedData(row));
    await expect(submitSponsoredRegistration(f.ctx, creator.address, row.id, signature)).rejects.toMatchObject({ code: "signature_invalid" });
    expect(f.chain.sign).not.toHaveBeenCalled(); expect((await f.get(row.id))?.state).toBe("prepared");
  });
  it("refuses changed source proof and creator nonce before incurring gas", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    f.claim.revision++;
    await expect(submitSponsoredRegistration(f.ctx, creator.address, row.id, signature)).rejects.toMatchObject({ code: "proof_changed" });
    f.claim.revision--; f.chain.registrationNonce.mockResolvedValue(BigInt(1));
    await expect(submitSponsoredRegistration(f.ctx, creator.address, row.id, signature)).rejects.toMatchObject({ code: "nonce_changed" });
    expect(f.chain.sign).not.toHaveBeenCalled();
  });
  it("refuses gas above the admitted ceiling without a signature or broadcast", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    f.chain.estimateGas.mockResolvedValue(BigInt(400001));
    await expect(submitSponsoredRegistration(f.ctx, creator.address, row.id, signature)).rejects.toMatchObject({ code: "gas_limit" });
    expect(f.chain.sign).not.toHaveBeenCalled(); expect(f.chain.broadcast).not.toHaveBeenCalled();
  });
  it("atomically refuses a publishing proof changed while external gas/nonce reads were pending", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    f.chain.transactionNonce.mockImplementation(async () => { f.claim.revision++; f.syncClaim(); return 7; });
    await expect(submitSponsoredRegistration(f.ctx, creator.address, row.id, signature)).rejects.toBeInstanceOf(Error);
    expect(f.chain.sign).not.toHaveBeenCalled(); expect(f.chain.broadcast).not.toHaveBeenCalled();
    expect((await f.get(row.id))?.state).toBe("prepared");
  });
  it("journals the exact signed hash before broadcasting and never signs/broadcasts twice", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    f.chain.broadcast.mockImplementation(async raw => { expect(await f.get(row.id)).toMatchObject({ state: "submitted", transactionHash: keccak256(raw), transactionNonce: 7 }); return keccak256(raw); });
    const submitted = await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature);
    expect(submitted.state).toBe("submitted");
    expect(await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature)).toEqual(submitted);
    expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.broadcast).toHaveBeenCalledTimes(1);
  });
  it("retains the original and full hold after a lost broadcast response", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    f.chain.broadcast.mockRejectedValue(new Error("private RPC diagnostics"));
    const result = await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature);
    expect(result).toMatchObject({ state: "submitted", reservedWei: f.ctx.policy.maxTransactionWei });
    await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature);
    expect(f.chain.broadcast).toHaveBeenCalledTimes(1);
  });
  it("retains signing uncertainty after key failure and provides inspection without a second signature", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    f.chain.sign.mockRejectedValue(new Error("private key diagnostics"));
    expect((await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature)).state).toBe("signing");
    await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature);
    expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.broadcast).not.toHaveBeenCalled();
  });
  it("rejects a signer that substitutes the actual transaction target", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    f.chain.sign.mockImplementation(transaction => sponsor.signTransaction({ ...transaction, to: creator.address }));
    expect((await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature)).state).toBe("signing");
    expect(f.chain.broadcast).not.toHaveBeenCalled();
  });
  it.each(["success", "reverted"] as const)("recovers the exact %s receipt after the sponsorship policy expires", async status => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    const submitted = await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature);
    f.setReceipt(f.makeReceipt(submitted.transactionHash!, status));
    f.ctx.assertPolicy = () => { throw new Error("expired"); };
    const recovered = await recoverSponsoredRegistration(f.db, creator.address, row.id, f.chain, now + 4_000_000);
    expect(recovered).toMatchObject({ state: status === "success" ? "confirmed" : "reverted", actualGasWei: "5000000000000000" });
    expect(f.chain.broadcast).toHaveBeenCalledTimes(1); expect(f.chain.sign).toHaveBeenCalledTimes(1);
  });
  it("does not treat a successful receipt for another event/source as registration", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    const submitted = await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature);
    const receipt = f.makeReceipt(submitted.transactionHash!); receipt.logs = []; f.setReceipt(receipt);
    await expect(recoverSponsoredRegistration(f.db, creator.address, row.id, f.chain, now)).rejects.toMatchObject({ code: "receipt_mismatch" });
    expect((await f.get(row.id))?.state).toBe("submitted");
  });
  it("rejects receipt sender substitution without releasing the gas hold", async () => {
    const f = fixture(), row = await f.prepare(), signature = await creator.signTypedData(registrationTypedData(row));
    const submitted = await submitSponsoredRegistration(f.ctx, creator.address, row.id, signature);
    f.setReceipt({ ...f.makeReceipt(submitted.transactionHash!), from: creator.address });
    await expect(recoverSponsoredRegistration(f.db, creator.address, row.id, f.chain, now)).rejects.toMatchObject({ code: "receipt_mismatch" });
    expect((await f.get(row.id))?.actualGasWei).toBeUndefined();
  });
});
