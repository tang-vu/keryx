import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionResult, type Hex } from "viem";
import { REGISTRY_ABI } from "../registry/registry-abi";
import { sourceId } from "../registry/registry-client";
import { STORAGE_MAINNET_PILOT_PROFILE_DIGEST, type StorageIdentity } from "../db/storage-identity";
import { createSqliteStorage } from "../db/storage-identity-provision";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { encryptContent } from "../ipfs/content-crypto";
import { contentBodyHash } from "../sources/content-receipt";
import { createSyntheticPilotServerContext, getLivePilotServerContext, type PilotServerContext } from "./server-context";
import { pinPilotPolicy, type PilotPolicy } from "./policy";
import { servePilotPayment } from "./seller";
import { runPilotBrowserAsk } from "./run-browser-ask";
import { handlePilotRequest } from "./handlers";
import { createPilotGrantMessage, publicMainnetEnrollmentDigest } from "./public-enrollment";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sourceItemIdentity } from "../sources/source-item-asset";
import { deploymentIngressDenied } from "./ingress-mode";
import { getPaymentGateway } from "../payments/payment-gateway";
import { RealGateway } from "../payments/real-gateway";
import { getDb } from "../db";
import { canonicalJson } from "../canonical-json";
import * as contentResolver from "../sources/resolve-source-item-content";
import { config } from "../config";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function fixture(extraUnavailableSource = false) {
  vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  const owner = privateKeyToAccount(generatePrivateKey()), signer = privateKeyToAccount(generatePrivateKey());
  const creator = privateKeyToAccount(generatePrivateKey()), payout = "0x2222222222222222222222222222222222222222";
  const sourceUrl = "https://publisher.example/arc", id = sourceId(creator.address, sourceUrl);
  const badSourceUrl = `${sourceUrl}/inactive`, badId = sourceId(creator.address, badSourceUrl);
  const registry = "0x3333333333333333333333333333333333333333";
  const policy: PilotPolicy = { format: "keryx-mainnet-enrollment-v1", network: ARC_MAINNET_PROFILE,
    epoch: "synthetic-one", expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600,
    candidateDigest: "11".repeat(32), releaseCommit: "a".repeat(40), origin: "https://pilot.example",
    registryAddress: registry, invitedBuyers: [owner.address.toLowerCase()], retainedTestnetSigners: ["0x4444444444444444444444444444444444444444"],
    approvedSourceIds: extraUnavailableSource ? [id, badId] : [id], approvedCreatorAddresses: [creator.address.toLowerCase()], approvedPayoutAddresses: [payout],
    limits: { totalMicros: 50000, perBuyerMicros: 50000, perAskMicros: 20000, perPaymentMicros: 10000, maxAsks: 3 } };
  let chainId: string = ARC_MAINNET_PROFILE.chainIdHex, active = true, calls = 0, loseReceipt = false;
  const rpc = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = payload.method === "eth_chainId" ? chainId : payload.method === "eth_call" ?
      encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: { creator: creator.address, payoutWallet: payout,
        authors: [{ wallet: payout, basisPoints: 10000 }], fetchPriceUsdc6: BigInt(1000), contentCid: "", tags: "arc",
        active: active && !String(payload.params?.[0]?.data).endsWith(badId.slice(2)) } }) :
      { number: "0x1", hash: `0x${"77".repeat(32)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
  });
  rpc.listen(0, "127.0.0.1"); await once(rpc, "listening");
  cleanup.push(() => new Promise<void>((resolve, reject) => rpc.close(error => error ? reject(error) : resolve())));
  const folder = mkdtempSync(join(tmpdir(), "keryx-pilot-synthetic-")), file = join(folder, "empty.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-pilot-storage-identity-v1", deploymentId: randomUUID(), storageId: randomUUID(),
    network: "eip155:5042", authorityMode: "mainnet-pilot-real", profileDigest: STORAGE_MAINNET_PILOT_PROFILE_DIGEST,
    enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(), provenanceDigest: pinPilotPolicy(policy).digest };
  await createSqliteStorage(file, identity);
  const deployment = { format: "keryx-storage-deployment-v1" as const, identity, backend: { kind: "sqlite" as const, databasePath: file } };
  const createContext = () => createSyntheticPilotServerContext({ policy, deployment, engine: new HeuristicEngine(),
    fundedCapacityMicros: async () => 50000,
    rpcUrl: `http://127.0.0.1:${(rpc.address() as { port: number }).port}`, seller: (request, context) => servePilotPayment(request, context, {
      verify: async () => ({ isValid: true }), settle: async () => { calls++;
        if (loseReceipt) throw new Error("synthetic lost response");
        return { success: true, payer: signer.address, network: "eip155:5042", transaction: `synthetic-only:${calls}` }; } }) });
  const context = await createContext(); cleanup.push(() => context.close());
  await context.db.upsertSource({ id, onchainId: id, name: "Arc research", url: sourceUrl, description: "Arc payment settlement journal research",
    walletAddress: payout, fetchPrice: 0.001, tags: ["arc", "payment", "settlement"], authors: [{ name: "Creator", walletAddress: payout, splitWeight: 1 }],
    createdAt: new Date().toISOString(), verified: true, active: true });
  if (extraUnavailableSource) await context.db.upsertSource({ ...(await context.db.getSource(id))!, id: badId, onchainId: badId,
    name: "Unavailable source", url: badSourceUrl });
  const plaintext = "Arc payment settlement journals retain signed authorizations after an interrupted payment response. The Arc journal verifies source payout authority before every payment.";
  const encrypted = encryptContent(plaintext);
  await context.db.addItems([{ id: "fresh-article", sourceId: id, title: "Arc payment settlement journal", link: `${sourceUrl}/article`,
    summary: "Arc payment settlement journal retains signed authorization", content: encrypted.cipherB64,
    deliveryKind: "full_text", storageMode: "db_encrypted", plaintextBytes: Buffer.byteLength(plaintext), bodyHash: contentBodyHash(plaintext),
    itemKeyEnc: encrypted.wrappedKeyB64, itemIv: encrypted.ivB64, itemAuthTag: encrypted.authTagB64, itemWrapIv: encrypted.wrapIvB64 }]);
  const challengeResponse = await handlePilotRequest(pilotRequest(context, "/grant/challenge", { owner: owner.address.toLowerCase(), signer: signer.address.toLowerCase() }), context);
  expect(challengeResponse.status).toBe(200);
  const { enrollmentDigest, ...fields } = await challengeResponse.json();
  const signature = await owner.signMessage({ message: createPilotGrantMessage({ enrollment: context.policy, enrollmentDigest }, fields) });
  const delegation = { ...fields, enrollmentDigest, signature };
  const grantResponse = await handlePilotRequest(pilotRequest(context, "/grant", delegation), context);
  expect(grantResponse.status).toBe(200);
  const cookie = grantResponse.headers.get("set-cookie")!.split(";")[0];
  return { context, policy, signer, ownerAccount: owner, owner: owner.address.toLowerCase(), cookie, delegation, id, badId, folder, file, identity, deployment, createContext,
    setChain: (value: typeof chainId) => { chainId = value; }, deactivate: () => { active = false; }, calls: () => calls,
    loseReceipt: () => { loseReceipt = true; } };
}

function pilotRequest(context: PilotServerContext, path: string, body?: unknown, cookie?: string, method = "POST") {
  return new Request(`${context.policy.origin}/api/mainnet-pilot${path}`, { method,
    headers: { origin: context.policy.origin, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function signChallenge(signer: ReturnType<typeof privateKeyToAccount>, data: Record<string, unknown>) {
  const req = data.requirements as { payTo: Hex; amount: string; maxTimeoutSeconds: number };
  const now = Math.floor(Date.now() / 1000);
  const authorization = { from: signer.address, to: req.payTo, value: req.amount, validAfter: String(now - 1),
    validBefore: String(now + req.maxTimeoutSeconds), nonce: data.admittedNonce as Hex };
  const signature = await signer.signTypedData({ domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042,
    verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet }, types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization", message: { ...authorization, value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) } });
  return Buffer.from(JSON.stringify({ signature, authorization })).toString("base64");
}

async function dispatch(context: PilotServerContext, cookie: string, signer: ReturnType<typeof privateKeyToAccount>) {
  const response = await handlePilotRequest(pilotRequest(context, "/ask",
    { question: "How do Arc payment settlement journals retain signed authorizations?", budgetUsd: 0.02 }, cookie), context);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(); let pending = ""; const events: { event: string; data: Record<string, unknown> }[] = [];
  for (;;) {
    const part = await reader.read(); if (part.done) break; pending += new TextDecoder().decode(part.value);
    let end: number;
    while ((end = pending.indexOf("\n\n")) >= 0) {
      const packet = pending.slice(0, end); pending = pending.slice(end + 2);
      const event = packet.split("\n")[0].slice(7), data = JSON.parse(packet.split("\n")[1].slice(6)); events.push({ event, data });
      if (event === "sign-request") {
        const response = await handlePilotRequest(pilotRequest(context, "/challenge", { reqId: data.reqId }, cookie), context);
        expect(response.status).toBe(200); const challenge = await response.json();
        expect(challenge.expectedNonce).toBe(data.admittedNonce);
        expect(challenge.requirements).toEqual(data.requirements);
        const signed = await handlePilotRequest(pilotRequest(context, "/sign", { reqId: data.reqId,
          paymentHeader: await signChallenge(signer, { ...challenge, admittedNonce: challenge.expectedNonce }) }, cookie), context);
        expect(await signed.json()).toEqual({ ok: true, delivered: true });
      }
    }
  }
  return events;
}

async function concurrentAdmissions(f: Awaited<ReturnType<typeof fixture>>, operations: unknown[]) {
  const jobs = operations.map(operation => {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./admission-process-fixture.mts", import.meta.url))],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "test" } });
    let output = "", errors = "";
    child.stderr.on("data", (bytes: Buffer) => { errors += bytes.toString(); });
    let ready!: () => void;
    const booted = new Promise<void>(resolve => { ready = resolve; });
    child.stdout.on("data", (bytes: Buffer) => { output += bytes.toString(); if (output.startsWith("ready\n")) ready(); });
    const result = new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("Synthetic admission deadline")); }, 45000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", code => {
        clearTimeout(timer); ready();
        if (code !== 0) reject(new Error(`Synthetic admission failed: ${errors.slice(0, 1500)}`));
        else resolve(JSON.parse(output.trim().split("\n")[1]).admitted);
      });
    });
    child.stdin.write(`${JSON.stringify({ policy: f.policy, deployment: f.deployment })}\n`);
    return { booted, result, go: () => child.stdin.end(`${JSON.stringify(operation)}\n`) };
  });
  await Promise.all(jobs.map(job => job.booted));
  for (const job of jobs) job.go();
  return Promise.all(jobs.map(job => job.result));
}

it("keeps the live composition closed and rejects caller-fabricated contexts", async () => {
  await expect(getLivePilotServerContext()).rejects.toThrow("closed");
  expect((await runPilotBrowserAsk(new Request("https://pilot.example/api/mainnet-pilot/ask"), {} as PilotServerContext, "x")).status).toBe(400);
});
it("streams the actual shared agent, exposed journal, signatures and registry seller with synthetic receipts", async () => {
  const f = await fixture(); const events = await dispatch(f.context, f.cookie, f.signer);
  const done = events.find(e => e.event === "done"); expect(done).toBeDefined();
  expect(events.some(e => e.event === "error")).toBe(false);
  expect(f.calls()).toBe(2);
  const payments = await f.context.db.listPayments(100); expect(payments.length).toBeGreaterThanOrEqual(1);
  expect(payments.every(p => p.network === "eip155:5042" && p.settled && p.txHash?.startsWith("synthetic-only:"))).toBe(true);
  expect(payments.map(p => p.kind).sort()).toEqual(["citation", "fetch"]);
  expect(JSON.stringify(done)).toContain("retain signed authorizations");
  expect((done!.data.citations as { sourceId: string }[]).some(c => c.sourceId === f.id)).toBe(true);
}, 30000);
it("retains lost-response authorizations across restart and never resubmits their nonce", async () => {
  const f = await fixture(); f.loseReceipt(); await dispatch(f.context, f.cookie, f.signer);
  expect(f.calls()).toBe(1);
  const payments = await f.context.db.listPayments(100); expect(payments[0]?.settlementStatus).toBe("pending");
  f.context.close(); const reopened = await f.createContext(); cleanup.push(() => reopened.close());
  const raw = new DatabaseSync(f.file); const claimed = raw.prepare("SELECT nonce,header_hash FROM mainnet_pilot_settlement_attempts").get(); raw.close();
  expect(claimed).toBeDefined(); expect(reopened.admissions.claimSettlement(String(claimed!.nonce), String(claimed!.header_hash))).toBe(false);
  const retained = await reopened.db.listPayments(100); expect(retained[0]?.settlementStatus).toBe("pending");
  expect(f.calls()).toBe(1);
}, 30000);
it("binds owner delegation, cookie reload, single-use epoch and revocation without resetting retained reservations", async () => {
  const f = await fixture();
  expect(f.context.enrollmentDigest).toBe(await publicMainnetEnrollmentDigest(f.policy));
  expect((await handlePilotRequest(pilotRequest(f.context, "/grant", undefined, f.cookie, "GET"), f.context)).status).toBe(200);
  expect((await handlePilotRequest(pilotRequest(f.context, "/grant", f.delegation), f.context)).status).toBe(403);
  expect((await handlePilotRequest(pilotRequest(f.context, "/ask", { question: "test", budgetUsd: 0.02 }), f.context)).status).toBe(403);
  await dispatch(f.context, f.cookie, f.signer);
  const capacity = (await f.context.getGrant(f.owner))!.spent;
  expect(capacity).toBeGreaterThan(0);
  expect((await handlePilotRequest(pilotRequest(f.context, "/grant", undefined, f.cookie, "DELETE"), f.context)).status).toBe(200);
  expect((await handlePilotRequest(pilotRequest(f.context, "/grant", undefined, f.cookie, "GET"), f.context)).status).toBe(403);
  expect((await handlePilotRequest(pilotRequest(f.context, "/grant", f.delegation), f.context)).status).toBe(403);
  expect((await f.context.db.listPayments(100)).length).toBeGreaterThan(0);
  const raw = new DatabaseSync(f.file);
  expect(Number(raw.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(f.signer.address.toLowerCase())?.spent_micro)).toBe(Math.round(capacity * 1e6));
  raw.close();
}, 30000);
it("delivers a valid-source answer when another approved registry source becomes unavailable", async () => {
  const f = await fixture(true), events = await dispatch(f.context, f.cookie, f.signer);
  expect(events.find(e => e.event === "done")).toBeDefined();
  expect(events.some(e => e.event === "error")).toBe(false);
  expect(events.find(e => e.event === "source-unavailable")?.data.sourceId).toBe(f.badId);
  expect((await f.context.db.listPayments(100)).every(p => p.sourceId === f.id)).toBe(true);
}, 30000);
it("authenticates public immutable previews without disclosing ciphertext, plaintext or wrapping keys", async () => {
  const f = await fixture(), item = (await f.context.db.getItems(f.id))[0];
  const identity = sourceItemIdentity(item), path = `/source/${f.id}/item/${item.id}/preview?version=${encodeURIComponent(identity.contentVersion)}`;
  const response = await handlePilotRequest(pilotRequest(f.context, path, undefined, f.cookie, "GET"), f.context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sourceId: f.id, item: identity, payTo: f.policy.approvedPayoutAddresses[0], listPriceMicroUsdc: "1000" });
  expect((await handlePilotRequest(pilotRequest(f.context, path, undefined, undefined, "GET"), f.context)).status).toBe(403);
}, 30000);
it("replaces owner grants with a fresh epoch while retaining signer capacity and invalidating the old cookie", async () => {
  const f = await fixture(); await dispatch(f.context, f.cookie, f.signer);
  const before = (await f.context.getGrant(f.owner))!.spent;
  const issued = await handlePilotRequest(pilotRequest(f.context, "/grant/challenge", { owner: f.owner, signer: f.signer.address.toLowerCase() }), f.context);
  const { enrollmentDigest, ...fields } = await issued.json();
  expect(fields.grantEpoch).not.toBe(f.delegation.grantEpoch);
  const signature = await f.ownerAccount.signMessage({ message: createPilotGrantMessage({ enrollment: f.context.policy, enrollmentDigest }, fields) });
  const replaced = await handlePilotRequest(pilotRequest(f.context, "/grant", { ...fields, signature, enrollmentDigest }), f.context);
  expect(replaced.status).toBe(200);
  expect((await f.context.getGrant(f.owner))!.spent).toBe(before);
  expect((await handlePilotRequest(pilotRequest(f.context, "/grant", undefined, f.cookie, "GET"), f.context)).status).toBe(403);
  expect((await handlePilotRequest(pilotRequest(f.context, "/grant", f.delegation), f.context)).status).toBe(403);
}, 30000);
it("refuses a stale logout after a second SQLite connection replaces the captured grant", async () => {
  const f = await fixture(); await dispatch(f.context, f.cookie, f.signer);
  const oldFields = { ...f.delegation };
  const spent = (await f.context.getGrant(f.owner))!.spent;
  const replacement = await f.createContext(); cleanup.push(() => replacement.close());
  const fields = replacement.admissions.issueGrant(f.owner, f.signer.address.toLowerCase(), 50000);
  replacement.admissions.consumeGrant(fields, "55".repeat(32));
  expect(f.context.admissions.revokeGrant(oldFields)).toBe(false);
  expect((await f.context.getGrant(f.owner))!.grantEpoch).toBe(fields.grantEpoch);
  expect((await f.context.getGrant(f.owner))!.spent).toBe(spent);
  expect((await f.context.db.listPayments(100)).map(p => p.kind).sort()).toEqual(["citation", "fetch"]);
  expect(replacement.admissions.revokeGrant(fields)).toBe(true);
  expect(await f.context.getGrant(f.owner)).toBeUndefined();
  const raw = new DatabaseSync(f.file);
  expect(Number(raw.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?")
    .get(f.signer.address.toLowerCase())?.spent_micro)).toBe(Math.round(spent * 1e6));
  raw.close();
}, 30000);
it("refuses legacy DB and treasury initialization on the sealed pilot domain even with a legacy key present", async () => {
  const f = await fixture(); const manifestPath = join(f.folder, "deployment.json"); writeFileSync(manifestPath, canonicalJson(f.deployment));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); vi.stubEnv("KERYX_MAINNET_PILOT_ORIGIN", f.policy.origin);
  vi.stubEnv("KERYX_FUNDER_PRIVATE_KEY", generatePrivateKey());
  await expect(getDb()).rejects.toThrow("Legacy authority");
  await expect(getPaymentGateway(f.context.db)).rejects.toThrow("Legacy authority");
  expect(() => new RealGateway()).toThrow("Legacy authority");
  expect(deploymentIngressDenied(new Request("https://forged.example/api/ask", { method: "POST" }))).toBe(true);
  expect(deploymentIngressDenied(new Request(`${f.policy.origin}/api/mcp`, { method: "POST" }))).toBe(true);
  expect(deploymentIngressDenied(new Request(`${f.policy.origin}/api/mainnet-pilot/grant`, { method: "GET" }))).toBe(false);
}, 30000);
it("refuses forged callbacks and acknowledges an exposed signature after restart without creating submission authority", async () => {
  const f = await fixture(), grant = (await f.context.getGrant(f.owner))!, queryId = randomUUID(), reqId = randomUUID();
  expect(f.context.admissions.admitQuery(queryId, f.owner, grant.sessAddr, grant.grantEpoch, 1000)).toBe(true);
  const requirements = { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
    amount: "1000", payTo: f.policy.approvedPayoutAddresses[0], maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } };
  const admitted = await f.context.db.admitBrowserJournal({ sessionId: f.owner, requestId: reqId, queryId, grantEpoch: grant.grantEpoch,
    signer: grant.sessAddr, network: ARC_MAINNET_PROFILE.networkId, token: ARC_MAINNET_PROFILE.usdcAddress,
    gatewayContract: ARC_MAINNET_PROFILE.gatewayWallet, sourceId: f.id, offerId: null, kind: "fetch",
    payee: requirements.payTo, amountMicroUsdc: 1000, requirements, payment: { kind: "fetch", queryId, sourceId: f.id,
      sourceName: "Arc research", payer: grant.sessAddr, payee: requirements.payTo, amountUsdc: 0.001,
      network: ARC_MAINNET_PROFILE.networkId, grantEpoch: grant.grantEpoch, origin: "web" } });
  expect(admitted.status).toBe("admitted"); if (admitted.status !== "admitted") throw new Error("Synthetic admission failed");
  await f.context.db.exposeBrowserJournal(f.owner, reqId);
  const promise = f.context.signatures.awaitHeader(f.context, f.owner, grant.sessAddr, grant.grantEpoch, new AbortController().signal, () => {})
    (reqId, requirements, "fetch", f.id, undefined, admitted.journal.nonce);
  const packet = { requirements, admittedNonce: admitted.journal.nonce };
  const forged = await signChallenge(privateKeyToAccount(generatePrivateKey()), packet);
  expect((await handlePilotRequest(pilotRequest(f.context, "/sign", { reqId, paymentHeader: forged }, f.cookie), f.context)).status).toBe(403);
  expect((await f.context.db.getBrowserJournal(f.owner, reqId))!.phase).toBe("exposed");
  const header = await signChallenge(f.signer, packet);
  const callback = await handlePilotRequest(pilotRequest(f.context, "/sign", { reqId, paymentHeader: header }, f.cookie), f.context);
  expect(await callback.json()).toEqual({ ok: true, delivered: true }); expect(await promise).toBe(header);
  f.context.close(); const reopened = await f.createContext(); cleanup.push(() => reopened.close());
  const recovery = await handlePilotRequest(pilotRequest(reopened, "/sign", { reqId, paymentHeader: header }, f.cookie), reopened);
  expect(await recovery.json()).toEqual({ ok: true, delivered: false });
  expect((await reopened.db.getBrowserJournal(f.owner, reqId))!.phase).toBe("signed");
  expect((await reopened.getGrant(f.owner))!.spent).toBe(0.001); expect(f.calls()).toBe(0);
}, 30000);
it("retains a confirmed debit when decryption fails without inventing reading or citation evidence", async () => {
  const f = await fixture(); vi.spyOn(contentResolver, "resolveSourceItemContent").mockRejectedValueOnce(new Error("synthetic unavailable decryption"));
  const events = await dispatch(f.context, f.cookie, f.signer), done = events.find(e => e.event === "done")!;
  expect(done).toBeDefined(); expect(done.data.citations).toEqual([]);
  expect(String(done.data.answer)).toContain("No supported answer");
  const payments = await f.context.db.listPayments(100);
  expect(payments).toHaveLength(1); expect(payments[0].kind).toBe("fetch"); expect(payments[0].settled).toBe(true);
  expect(payments[0].authorizationPhase).toBe("settled"); expect(f.calls()).toBe(1);
}, 30000);
it("rejects wrong-chain and deactivated registry authority without database payout fallback", async () => {
  const f = await fixture(), source = (await f.context.db.getSource(f.id))!;
  f.setChain("0x4cef52"); await expect(f.context.sourceAuthority.resolve(source)).rejects.toThrow();
  f.setChain(ARC_MAINNET_PROFILE.chainIdHex); f.deactivate(); await expect(f.context.sourceAuthority.resolve(source)).rejects.toThrow();
  expect(f.calls()).toBe(0);
}, 30000);
it("atomically retains ask allocations and enforces per-buyer and total caps after restart", async () => {
  const f = await fixture(), grant = (await f.context.getGrant(f.owner))!;
  for (let i = 0; i < 2; i++) expect(f.context.admissions.admitQuery(randomUUID(), f.owner, f.signer.address.toLowerCase(), grant.grantEpoch, 20000)).toBe(true);
  expect(f.context.admissions.admitQuery(randomUUID(), f.owner, f.signer.address.toLowerCase(), grant.grantEpoch, 20000)).toBe(false);
  f.context.close(); const reopened = await f.createContext(); cleanup.push(() => reopened.close());
  expect(reopened.admissions.admitQuery(randomUUID(), f.owner, f.signer.address.toLowerCase(), grant.grantEpoch, 20000)).toBe(false);
}, 30000);
it("serializes competing native processes at both ask allocation and journal nonce admission boundaries", async () => {
  const f = await fixture(), grant = (await f.context.getGrant(f.owner))!;
  expect(f.context.admissions.admitQuery(randomUUID(), f.owner, grant.sessAddr, grant.grantEpoch, 20000)).toBe(true);
  const askResults = await concurrentAdmissions(f, [0, 1].map(() => ({ kind: "query", owner: f.owner, queryId: randomUUID(), amount: 20000 })));
  expect(askResults.filter(Boolean)).toHaveLength(1);
  const queryId = randomUUID();
  expect(f.context.admissions.admitQuery(queryId, f.owner, grant.sessAddr, grant.grantEpoch, 1000)).toBe(true);
  const paymentResults = await concurrentAdmissions(f, [0, 1].map(() => ({ kind: "journal", owner: f.owner, sourceId: f.id,
    queryId, requestId: randomUUID(), amount: 1000 })));
  expect(paymentResults.filter(Boolean)).toHaveLength(1);
  const raw = new DatabaseSync(f.file);
  try {
    expect(raw.prepare("SELECT count(*) AS n FROM browser_authorization_intents").get()?.n).toBe(1);
    expect(raw.prepare("SELECT spent_micro FROM mainnet_pilot_queries WHERE query_id=?").get(queryId)?.spent_micro).toBe(1000);
    expect(raw.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(grant.sessAddr)?.spent_micro).toBe(1000);
    expect(raw.prepare("SELECT spent_micro FROM browser_retained_grants WHERE grant_epoch=?").get(grant.grantEpoch)?.spent_micro).toBe(1000);
  } finally { raw.close(); }
}, 90000);
it("refuses reuse/adoption of an existing pilot file and a mismatched reviewed policy", async () => {
  const f = await fixture(); await expect(createSqliteStorage(f.file, f.identity)).rejects.toThrow();
  await expect(createSyntheticPilotServerContext({ policy: { ...f.policy, releaseCommit: "b".repeat(40) }, deployment: f.deployment,
    rpcUrl: "http://127.0.0.1:1", engine: new HeuristicEngine(), fundedCapacityMicros: async () => 50000,
    seller: async () => Response.json({}) })).rejects.toThrow("identity refused");
}, 30000);
