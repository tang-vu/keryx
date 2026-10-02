import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../db/storage-identity";
import { createSqliteStorage } from "../db/storage-identity-provision";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it("checks native custody before checkout, retains selected receipt/claim and recovers original jobs after admission closes", async () => {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-monthly-mainnet-api-")), file = join(folder, "fresh.sqlite");
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: ARC_MAINNET_PROFILE.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(file, identity);
  const manifest = join(folder, "storage.json");
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), treasuryKey = `0x${"77".repeat(32)}` as const;
  const treasury = privateKeyToAccount(treasuryKey), payee = `0x${"33".repeat(20)}`;
  for (const [name, value] of Object.entries({ KERYX_STORAGE_MANIFEST: manifest, KERYX_SQLITE_PATH: file,
    KERYX_FORCE_OFFLINE: "0", CONTENT_MASTER_KEY: randomBytes(32).toString("hex"), KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc",
    KERYX_REGISTRY_ADDRESS: `0x${"55".repeat(20)}`, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: `0x${"55".repeat(20)}`,
    BASE_URL: "https://keryx.cc", SELLER_ADDRESS: payee, KERYX_MONTHLY_ENABLED: "1", KERYX_A2A_DEFAULT_BUDGET: "0.45",
    KERYX_MAINNET_TREASURY_PRIVATE_KEY: treasuryKey })) vi.stubEnv(name, value);
  const { storageIdentityDigest } = await import("../db/storage-identity"), policies = await import("../payments/hosted-treasury-policy");
  const policy = { format: "keryx-hosted-treasury-policy-v1" as const, network: "eip155:5042" as const,
    storageIdentityDigest: storageIdentityDigest(identity), origin: "https://keryx.cc", signer: treasury.address.toLowerCase(),
    lifetimeCapMicroUsdc: "10000000", queryCapMicroUsdc: "1000000", expiresAtSeconds: Math.floor(Date.now()/1000)+3600 };
  vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_JSON", canonicalJson(policy));
  vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_DIGEST", policies.hostedTreasuryPolicyDigest(policy));
  vi.doMock("../rate-limit", () => ({ checkRateLimit: async () => null, clientIp: () => "synthetic-fixture" }));
  cleanups.push(() => vi.doUnmock("../rate-limit"));
  const db = await (await import("../db")).getDb(); cleanups.push(() => (db as unknown as { close(): void }).close());
  const native = new DatabaseSync(file); cleanups.push(() => native.close());
  let receiptNetwork = "eip155:5042", settleCalls = 0, vendorCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), body = JSON.parse(String(init?.body ?? "{}"));
    if (new URL(url).origin === new URL(ARC_MAINNET_PROFILE.rpcUrl).origin) return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x13b2" });
    vendorCalls++;
    expect(new URL(url).origin).toBe("https://gateway-api.circle.com");
    if (url.endsWith("/v1/balances")) return Response.json({ token: "USDC", balances: [{ depositor: treasury.address.toLowerCase(), domain: 26, balance: "10" }] });
    expect(body.paymentRequirements).toMatchObject({ network: "eip155:5042", asset: ARC_MAINNET_PROFILE.usdcAddress, extra: { verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } });
    if (url.endsWith("/verify")) return Response.json({ isValid: true, payer: owner.address });
    expect(url.endsWith("/settle")).toBe(true);
    settleCalls++;
    const nonce = body.paymentPayload.payload.authorization.nonce;
    const row = native.prepare("SELECT issued_data FROM research_purchase_authorizations WHERE authorization_id=?").get(nonce)!;
    expect(JSON.parse(String(row.issued_data)).submitted).toBe(true);
    return Response.json({ success: true, payer: owner.address, network: receiptNetwork, transaction: `synthetic-no-funds-${nonce}` });
  }));
  const { NextRequest } = await import("next/server"), route = await import("../../app/api/research/monthly/route");
  const http: typeof fetch = async (input, init) => {
    const req = new NextRequest(String(input), { ...init, signal: init?.signal ?? undefined });
    return req.method === "POST" ? route.POST(req) : req.method === "PATCH" ? route.PATCH(req) : route.GET(req);
  };
  const client = await import("./client"), { buyerTypedData } = await import("../buyer/protocol");
  await (await import("./readiness")).monthlyAdmissionQuote(db);
  const quote = await client.fetchMonthlyQuote(http);
  // An actual dedicated key mismatch refuses before even reading vendor capacity or issuing an authorization.
  vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY", `0x${"88".repeat(32)}`);
  const before = vendorCalls;
  expect((await http("https://keryx.cc/api/research/monthly", { method: "POST", body: JSON.stringify(quote), headers: { "content-type": "application/json", "x-keryx-monthly-payer": owner.address } })).status).toBe(503);
  expect(vendorCalls).toBe(before);
  expect(native.prepare("SELECT count(*) AS n FROM research_purchase_authorizations").get()?.n).toBe(0);
  vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY", treasuryKey);
  const purchase = () => client.buyMonthly({ quote, payer: owner.address,
    readWallet: async () => ({ address: owner.address, chainId: 5042, gatewayBalanceMicros: "10000000" }),
    sign: authorization => owner.signTypedData(buyerTypedData(authorization)), prepare: async () => {}, claim: async () => {} }, http);
  receiptNetwork = "eip155:5042002";
  const uncertain = await purchase(); expect(uncertain.status).toBe("submission_uncertain");
  expect(await db.getResearchMonthly(uncertain.monthlyId)).toBeNull();
  expect(native.prepare("SELECT count(*) AS n FROM research_purchase_authorizations").get()?.n).toBe(1);
  receiptNetwork = "eip155:5042";
  const purchased = await purchase(); expect(purchased.status).toBe("seller_reported_settled");
  expect((await db.getResearchMonthly(purchased.monthlyId))?.purchase).toMatchObject({ format: "keryx-research-monthly-purchase-v2", network: "eip155:5042", asset: ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(), gatewayContract: ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase() });
  const original = { monthlyId: purchased.monthlyId, requestId: randomUUID(), question: "Explain immutable original payment evidence", payer: owner.address };
  const sign = (message: string) => owner.signMessage({ message });
  const first = await client.submitMonthly(original, sign, http);
  const order = await db.getA2aOrder(first.queryId); expect(order?.request?.network).toBe("eip155:5042");
  vi.stubEnv("KERYX_MONTHLY_ENABLED", "0");
  expect((await client.submitMonthly(original, sign, http)).queryId).toBe(first.queryId);
  await expect(client.submitMonthly({ ...original, question: "Replace the original question" }, sign, http)).rejects.toThrow();
  await expect(client.submitMonthly({ ...original, requestId: randomUUID() }, sign, http)).rejects.toThrow();
  expect((await client.monthlyStatus(purchased.monthlyId, owner.address, sign, http)).remaining).toBe(3);
  expect(settleCalls).toBe(2);
}, 60_000);
