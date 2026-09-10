import { mkdtemp, readdir, unlink, rmdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SqliteAdapter } from "../db/sqlite-adapter";
const state = vi.hoisted(() => ({ balance: vi.fn(), config: { funderKey: "", networkId: "eip155:5042002", cctpDomain: 26,
  sellerAddress: `0x${"1".repeat(40)}`, privateResearchReservedPayees: `0x${"4".repeat(40)}` } }));
vi.mock("../config", () => ({ config: state.config }));
vi.mock("../gateway/gateway-balance", () => ({ getGatewayAvailableAtomic: state.balance }));
import { privatePurchaseBootstrap } from "./private-purchase-bootstrap";
import { privateRuntimePolicy } from "./private-runtime-policy";
import { privateWorkerConfigurationId } from "./private-worker-configuration";
import { privateWorkerStatusWriter } from "./private-worker-status";
import { createPrivateAuthorization } from "../buyer/private-request-commitment";
import { buyerTypedData, BUYER_NETWORK } from "../buyer/protocol";

let root: string, db: SqliteAdapter, payer: string, signer: string;
let writeStatus: ReturnType<typeof privateWorkerStatusWriter>;
let buyer: ReturnType<typeof privateKeyToAccount>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "keryx-purchase-bootstrap-"));
  vi.stubEnv("CONTENT_MASTER_KEY", "a".repeat(64)); // Synthetic in-memory database key.
  db = new SqliteAdapter(":memory:"); await db.init();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External HTTP forbidden"); }));
  state.config.funderKey = generatePrivateKey(); state.config.cctpDomain = 26;
  const key = generatePrivateKey(); signer = privateKeyToAccount(key).address;
  buyer = privateKeyToAccount(generatePrivateKey()); payer = buyer.address;
  const env = { KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_PRIVATE_PURCHASE_ENABLED: "1", KERYX_PRIVATE_PURCHASE_PAYERS: payer,
    KERYX_PRIVATE_TREASURY_PRIVATE_KEY: key, KERYX_PRIVATE_TREASURY_ADDRESS: signer,
    KERYX_PRIVATE_RESEARCH_PAYEE: state.config.privateResearchReservedPayees,
    KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: state.config.privateResearchReservedPayees,
    KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "100000", KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000",
    KERYX_PRIVATE_MODEL_ID: "deepseek-flash", KERYX_PRIVATE_PROVIDER: "deepseek",
    KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1", KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-secret",
    KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]',
    KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY: root, KERYX_COMMIT: "abcdef1" };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const policy = privateRuntimePolicy(env, { network: state.config.networkId, publicSeller: state.config.sellerAddress,
    publicTreasurySigners: [privateKeyToAccount(state.config.funderKey as `0x${string}`).address], privateTreasurySigner: signer })!;
  writeStatus = privateWorkerStatusWriter(root, "abcdef1", privateWorkerConfigurationId(policy));
  await writeStatus("idle"); state.balance.mockReset().mockResolvedValue(BigInt(100000));
});
afterEach(async () => {
  db.close(); for (const file of await readdir(root)) await unlink(join(root, file)); await rmdir(root);
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const signal = () => new AbortController().signal;

it("passes an allowed signed buyer through durable admission and single-use payment submission", async () => {
  const service = (await privatePurchaseBootstrap(db, signal()))!;
  const quote = service.quote({ question: "Synthetic private bootstrap payment case", budget: 0.03,
    researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" });
  const merchants = { privatePayee: state.config.privateResearchReservedPayees, publicResearchPayee: state.config.sellerAddress };
  const fresh = await createPrivateAuthorization(quote.request, quote.requirement, payer, merchants);
  const signature = await buyer.signTypedData(buyerTypedData(fresh.authorization));
  const submission = { request: fresh.request, salt: fresh.salt, payment: { authorization: fresh.authorization, signature } };
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const action = url.split("/").at(-1)!; calls.push(action);
    expect(url).toBe(`https://gateway-api-testnet.circle.com/v1/x402/${action}`);
    expect(["verify", "settle"]).toContain(action);
    expect(String(init.body)).not.toContain(quote.request.question);
    return Response.json(action === "verify" ? { isValid: true, payer } :
      { success: true, payer, network: BUYER_NETWORK, transaction: "synthetic-bootstrap-settlement" });
  }));
  const result = await service.submit(submission, payer);
  expect(result.response.paymentStatus).toBe("settled");
  expect((await service.submit(submission, payer)).response).toEqual(result.response);
  expect(calls).toEqual(["verify", "settle"]);
  expect(await db.listPrivateWorkerCandidates(signer)).toEqual([{ id: result.response.id, payer: payer.toLowerCase() }]);
  expect(await db.getPrivateTreasurySummary(signer)).toMatchObject({ allocatedMicros: "30000", unallocatedMicros: "70000" });
});

it("composes real status, SQLite backing and quote policy without a payment or reservation", async () => {
  const service = await privatePurchaseBootstrap(db, signal()); expect(service).not.toBeNull();
  const quote = service!.quote({ question: "Synthetic receipt research question", budget: 0.03,
    researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" });
  expect(quote.requirement.amount).toBe("50000");
  expect(JSON.stringify(quote)).not.toContain("synthetic-secret");
  expect(await db.getPrivateTreasurySummary(signer)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  // Rejected accounts cannot even reach submission parsing or persistent intent admission.
  await expect(service!.submit(null, `0x${"9".repeat(40)}`)).rejects.toThrow("unavailable for this account");
  await expect(service!.submit(null, "invalid")).rejects.toThrow("unavailable for this account");
  expect(await db.getPrivateTreasurySummary(signer)).toBeNull();
});

it.each([undefined, "0", "invalid"])("does not inspect or expose payment service with enable flag %s", async flag => {
  vi.stubEnv("KERYX_PRIVATE_PURCHASE_ENABLED", flag);
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull(); expect(state.balance).not.toHaveBeenCalled();
});

it("rejects non-pilot authenticated accounts before operational reads", async () => {
  expect(await privatePurchaseBootstrap(db, signal(), `0x${"9".repeat(40)}`)).toBeNull();
  expect(await privatePurchaseBootstrap(db, signal(), "invalid")).toBeNull();
  expect(state.balance).not.toHaveBeenCalled();
  expect(await privatePurchaseBootstrap(db, signal(), payer)).not.toBeNull();
});

it.each(["working", "degraded", "stopped", "recovering"] as const)("refuses observed worker phase %s", async phase => {
  await writeStatus(phase); expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
});

it("refuses missing, stale and mismatched worker observations", async () => {
  const file = join(root, "private-worker-status.json"); await unlink(file);
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
  await writeStatus("idle"); const record = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...record, recordedAt: Date.now() - 31000 }));
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
  await writeFile(file, JSON.stringify({ ...record, configurationId: "0".repeat(64) }));
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
  await writeStatus("idle"); vi.stubEnv("KERYX_COMMIT", "abcdef2");
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
});

it("refuses unknown/insufficient backing, worker changes during observation and cancellation", async () => {
  state.balance.mockResolvedValueOnce(null).mockResolvedValueOnce(BigInt(99999));
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
  state.balance.mockImplementationOnce(async () => { await writeStatus("working"); return BigInt(100000); });
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
  const stop = new AbortController(); stop.abort(); state.balance.mockClear();
  expect(await privatePurchaseBootstrap(db, stop.signal)).toBeNull(); expect(state.balance).not.toHaveBeenCalled();
});

it("refuses fully allocated treasury capacity even when the Gateway balance is sufficient", async () => {
  vi.spyOn(db, "getPrivateTreasurySummary").mockResolvedValue({ capacityMicros: "100000", allocatedMicros: "100000",
    unallocatedMicros: "0", committedMicros: "0", confirmedMicros: "0", unresolvedOrProcessingMicros: "0",
    conservativeBackingMicros: "100000", observation: "database-recorded", chainFinalityVerified: false });
  expect(await privatePurchaseBootstrap(db, signal())).toBeNull();
});

it.each(["", "*", `0x${"0".repeat(40)}`, Array(17).fill(`0x${"9".repeat(40)}`).join(",")])(
  "refuses invalid pilot payer policy", async payers => {
    vi.stubEnv("KERYX_PRIVATE_PURCHASE_PAYERS", payers);
    expect(await privatePurchaseBootstrap(db, signal())).toBeNull(); expect(state.balance).not.toHaveBeenCalled();
  });
