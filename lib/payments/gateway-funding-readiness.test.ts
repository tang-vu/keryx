import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { keccak256, parseTransaction } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalJson } from "../canonical-json";
import { provisionSyntheticStorage } from "../db/storage-identity-fixture";
import { scanFullStorageSnapshot } from "../db/storage-identity-snapshot";
import { inspectGatewayFundingSqliteOwnerTarget, installGatewayFundingSqliteOwnerAuthorization, installGatewayFundingSqliteOwnerPolicy,
  openGatewayFundingSqliteLedger, openGatewayFundingSqliteTerminalObserver } from "../db/gateway-funding-sqlite";
import type { GatewayFundingLedger, FundingReservationSnapshot } from "../db/gateway-funding-ledger-types";
import { createGatewayFundingReceiptObserverForTrustedComposition } from "./gateway-funding-receipt-observer";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "./gateway-funding-receipt-policy";
import { createGatewayFundingReadinessObserverForTrustedSyntheticComposition as compose,
  createGatewayFundingReadinessInspectionObserverForTrustedSyntheticComposition as composeInspection, unsealVerifiedGatewayFundingReadiness as unseal,
  assertVerifiedGatewayFundingReadinessCurrent as current, type GatewayFundingReadinessRequest, type VerifiedGatewayFundingReadiness } from "./gateway-funding-readiness";

const dirs: string[] = [], ledgers: GatewayFundingLedger[] = [];
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const q = (value: string | number) => `0x${BigInt(value).toString(16)}`;
let balanceHandler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void;
let receiptSlot: Readonly<FundingReservationSnapshot> | undefined, receiptStatus = "0x1";
let balanceCalls = 0, forbiddenWrites = 0;
const balances: unknown[] = [];
const server = createServer(async (req, res) => {
  // Receipt RPC and balance tests share this server. Close every response so
  // deliberate idle/blocking drills cannot race a reused stale RPC socket.
  res.setHeader("Connection", "close");
  let data = ""; for await (const chunk of req) data += chunk.toString();
  const body = JSON.parse(data);
  if (req.url === "/v1/balances") { balanceCalls++; balances.push({ method: req.method, body, authorization: req.headers.authorization }); balanceHandler(req, res, body); return; }
  const { method, id, params } = body, p = receiptSlot!.prepared!, t = p.transaction, sig = parseTransaction(p.rawTransaction);
  const blockHash = `0x${"a".repeat(64)}`, anchorHash = `0x${"b".repeat(64)}`, wall = 1800000000000; let result: unknown;
  if (method === "eth_chainId") result = q(5042002);
  else if (method === "eth_getTransactionByHash") result = { hash: p.transactionHash, from: t.sender, to: t.to, input: t.data, type: "0x2", chainId: q(t.chainId), nonce: q(t.nonce), value: q(t.valueWei), gas: q(t.gas), maxFeePerGas: q(t.maxFeePerGasWei), maxPriorityFeePerGas: q(t.maxPriorityFeePerGasWei), accessList: [], r: sig.r, s: sig.s, yParity: q(sig.yParity!), blockNumber: "0xa", blockHash, transactionIndex: "0x0" };
  else if (method === "eth_getTransactionReceipt") result = { transactionHash: p.transactionHash, from: t.sender, to: t.to, type: "0x2", status: receiptStatus, gasUsed: "0x2", effectiveGasPrice: "0x2", blockNumber: "0xa", blockHash, transactionIndex: "0x0" };
  else if (method === "eth_getBlockByNumber") result = params[0] === "0xa" ? { number: "0xa", hash: blockHash, timestamp: q(wall / 1000 - 2), transactions: [p.transactionHash] } : { number: "0xb", hash: anchorHash, timestamp: q(wall / 1000 - 1), transactions: [] };
  else throw new Error("Synthetic server has no sign/send method");
  res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
});
let endpoint: string;
async function fixture(status: "success" | "reverted" | "missing" | "pending" = "success") {
  const dir = mkdtempSync(join(tmpdir(), "funding-readiness-")); dirs.push(dir);
  const file = join(dir, "application.sqlite"), identity = await provisionSyntheticStorage(file, "testnet-real");
  const funder = privateKeyToAccount(generatePrivateKey()), spend = privateKeyToAccount(generatePrivateKey());
  const policy = { format: "gateway-funding-policy-v1" as const, identity, policyId: randomUUID(), funder: funder.address.toLowerCase(), spend: spend.address.toLowerCase(),
    lifetimeLimits: { nativeWei: "100", usdcMicros: "200", depositMicros: "200", gasWei: "800" }, maxTransactionGas: "10", maxFeePerGasWei: "20" };
  await installGatewayFundingSqliteOwnerPolicy(file, identity, { format: "gateway-funding-owner-installation-v1", policy,
    funderGasBudgetWei: "400", spendGasBudgetWei: "400", ...await inspectGatewayFundingSqliteOwnerTarget(file, identity), finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST,
    history: { format: "gateway-funding-empty-isolated-history-v1", documentDigest: "d".repeat(64), funderInitialNonce: "0", spendInitialNonce: "0" } });
  const operation = { format: "gateway-funding-operation-v1" as const, policy, operationId: randomUUID(), ownerAuthorizationId: randomUUID(), ownerAuthorizationDigest: "b".repeat(64),
    minimumAvailableMicros: "100", initialAvailableMicros: "90", nativeTransferWei: "50", usdcTransferMicros: "100", approvalMicros: "100", depositMicros: "100",
    gasLimits: { nativeTransfer: "10", usdcTransfer: "10", approval: "10", deposit: "10" }, maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1" };
  await installGatewayFundingSqliteOwnerAuthorization(file, identity, operation);
  const writer = openGatewayFundingSqliteLedger(file, identity), claim = randomUUID();
  try {
    await writer.admitOperation(operation.operationId);
    if (status !== "missing") {
      const slot = await writer.reserveStep(operation.operationId, "deposit", "0"); await writer.claimCrypto(operation.operationId, "deposit", claim);
      const rawTransaction = await spend.signTransaction(parseTransaction(slot.transaction.serializedUnsigned));
      await writer.savePrepared(operation.operationId, "deposit", claim, { rawTransaction, transactionHash: keccak256(rawTransaction) });
      await writer.claimBroadcast(operation.operationId, "deposit", randomUUID()); receiptSlot = (await writer.inspectReservation(operation.operationId, "deposit"))!;
      if (status !== "pending") {
      receiptStatus = status === "success" ? "0x1" : "0x0";
      const token = await createGatewayFundingReceiptObserverForTrustedComposition((_url, init) => fetch(endpoint.replace("/v1/balances", "/rpc"), init), () => 1800000000000)({
        operation, prepared: receiptSlot.prepared!, cryptoClaimId: claim, broadcastClaimId: receiptSlot.broadcastClaimId!, finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST }, () => {});
      expect(token).not.toBeNull(); const observer = openGatewayFundingSqliteTerminalObserver(file, identity);
      try { await observer.appendVerifiedTerminalObservation(operation.operationId, "deposit", token!); } finally { observer.close(); }
      }
    }
  } finally { writer.close(); }
  const actual = openGatewayFundingSqliteLedger(file, identity, { readOnly: true }); ledgers.push(actual);
  const writes = new Set(["admitOperation", "reserveStep", "claimCrypto", "savePrepared", "claimBroadcast", "appendCandidateObservation"]);
  // Trusted composition forwards actual native inspection; all mutations fail.
  const ledger = new Proxy({} as GatewayFundingLedger, { get(_target, property) {
    if (writes.has(String(property))) return () => { forbiddenWrites++; throw new Error("No readiness writes allowed"); };
    const value = Reflect.get(actual, property); return typeof value === "function" ? value.bind(actual) : value;
  } });
  const ns = await ledger.inspectNamespace(policy.spend);
  const request: GatewayFundingReadinessRequest = { ledger, operationId: operation.operationId, expectedIdentity: identity,
    expectedBackendBindingDigest: ns.backendBindingDigest, installedPolicyDigest: digest(policy), finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST, assertCurrentAuthority: () => {} };
  const snapshot = () => { const db = new DatabaseSync(file, { readOnly: true }); try { return scanFullStorageSnapshot(db); } finally { db.close(); } };
  return { file, operation, request, snapshot, original: snapshot() };
}
let f: Awaited<ReturnType<typeof fixture>>, reverted: typeof f, missing: typeof f, pending: typeof f, drift: typeof f;
function available(value: string = "0.000100", extras = {}) { return { token: "USDC", balances: [{ depositor: f.operation.policy.spend, domain: 26, balance: value, ...extras }] }; }
function respond(value: unknown) { balanceHandler = (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); }; }
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error();
  endpoint = `http://127.0.0.1:${address.port}/v1/balances`;
});
// Independent native fixture provisioning has its own unchanged setup bound.
// One aggregate hook coupled four owner subprocess/SQLite lifecycles to 30s.
beforeAll(async () => { f = await fixture(); }, 30000);
beforeAll(async () => { reverted = await fixture("reverted"); }, 30000);
beforeAll(async () => { missing = await fixture("missing"); }, 30000);
beforeAll(async () => { pending = await fixture("pending"); }, 30000);
beforeAll(async () => { drift = await fixture(); }, 30000);
afterEach(() => { expect(f.snapshot()).toEqual(f.original); expect(reverted.snapshot()).toEqual(reverted.original); expect(missing.snapshot()).toEqual(missing.original); expect(pending.snapshot()).toEqual(pending.original); expect(forbiddenWrites).toBe(0); });
afterAll(async () => { ledgers.forEach(l => l.close()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })); });
describe("keyless current funding availability issuer", () => {
  it("requires actual finalized original and reads only available balance, with zero ledger/sign/send mutations", async () => {
    respond(available("0.000100", { withdrawing: "100", withdrawable: "200" })); const observe = compose(endpoint), token = await observe(f.request); expect(token).not.toBeNull();
    const evidence = await unseal(token!, f.request); current(token!, f.request);
    expect(evidence).toMatchObject({ basis: "finalized-original-deposit-plus-current-available", currentFundingReady: true, availableMicros: "100", minimumAvailableMicros: "100", depositor: f.operation.policy.spend, domain: 26 });
    expect(evidence.availableMicros).not.toBe((BigInt(f.operation.initialAvailableMicros) + BigInt(f.operation.depositMicros)).toString());
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(balances.at(-1)).toEqual({ method: "POST", body: { token: "USDC", sources: [{ depositor: f.operation.policy.spend, domain: 26 }] }, authorization: undefined });
  });
  it("returns immutable validated issuance evidence without changing retained-token unseal behavior", async () => {
    respond(available()); const observation = await composeInspection(endpoint)(f.request); expect(observation).not.toBeNull();
    expect(Object.isFrozen(observation)).toBe(true); expect(Object.isFrozen(observation!.evidence)).toBe(true);
    expect(Object.keys(observation!.token)).toEqual([]);
    expect(observation!.evidence).toMatchObject({ basis: "finalized-original-deposit-plus-current-available", availableMicros: "100" });
    expect(await unseal(observation!.token, f.request)).toEqual(observation!.evidence); current(observation!.token, f.request);
  });
  it.each(["wrong-token", "foreign-depositor", "foreign-domain", "duplicate", "missing", "negative", "precision", "overflow", "insufficient"])("refuses %s balance instead of retrying/depositing", async kind => {
    let value: unknown = available();
    if (kind === "wrong-token") value = { ...available(), token: "EURC" };
    if (kind === "foreign-depositor") value = available("0.000100", { depositor: f.operation.policy.funder });
    if (kind === "foreign-domain") value = available("0.000100", { domain: 25 });
    if (kind === "duplicate") value = { token: "USDC", balances: [...available().balances, ...available().balances] };
    if (kind === "missing") value = { token: "USDC", balances: [] };
    if (kind === "negative") value = available("-1"); if (kind === "precision") value = available("0.0001001");
    if (kind === "overflow") value = available((BigInt(2) ** BigInt(256)).toString()); if (kind === "insufficient") value = available("0.000099", { withdrawing: "100" });
    respond(value); const before = balanceCalls; expect(await compose(endpoint)(f.request)).toBeNull(); expect(balanceCalls - before).toBe(1);
  });
  it("refuses reverted/missing original before HTTP and rejects fabricated tokens", async () => {
    respond(available()); const before = balanceCalls;
    expect(await compose(endpoint)(reverted.request)).toBeNull(); expect(await compose(endpoint)(missing.request)).toBeNull(); expect(balanceCalls).toBe(before);
    expect(await compose(endpoint)(pending.request)).toBeNull(); expect(balanceCalls).toBe(before);
    expect(() => current({} as VerifiedGatewayFundingReadiness, f.request)).toThrow(); await expect(unseal({} as VerifiedGatewayFundingReadiness, f.request)).rejects.toThrow();
  });
  it("binds tokens to exact identity/backend/policy/finality/operation and trusted ledger", async () => {
    respond(available()); const token = await compose(endpoint)(f.request); expect(token).not.toBeNull();
    for (const changes of [{ operationId: randomUUID() }, { expectedBackendBindingDigest: "e".repeat(64) }, { installedPolicyDigest: "e".repeat(64) },
      { finalityPolicyDigest: "e".repeat(64) }, { expectedIdentity: { ...f.request.expectedIdentity, authorityMode: "testnet-offline" as const } }, { ledger: reverted.request.ledger }]) {
      await expect(unseal(token!, { ...f.request, ...changes })).rejects.toThrow();
    }
  });
  it("rejects authority/binding mutation during physical HTTP before issuance", async () => {
    const mutable = { ...f.request }; balanceHandler = (_req, res) => { mutable.expectedBackendBindingDigest = "e".repeat(64); res.end(JSON.stringify(available())); };
    expect(await compose(endpoint)(mutable)).toBeNull();
  });
  it("reloads actual namespace state on unseal and rejects a changed ledger snapshot", async () => {
    const isolated = drift;
    respond({ token: "USDC", balances: [{ depositor: isolated.operation.policy.spend, domain: 26, balance: "0.000100" }] });
    const token = await compose(endpoint)(isolated.request); expect(token).not.toBeNull();
    const next = { ...isolated.operation, operationId: randomUUID(), ownerAuthorizationId: randomUUID() };
    // Independent trusted owner/app activity, outside the readonly issuer.
    await installGatewayFundingSqliteOwnerAuthorization(isolated.file, isolated.request.expectedIdentity, next);
    const writer = openGatewayFundingSqliteLedger(isolated.file, isolated.request.expectedIdentity);
    try { await writer.admitOperation(next.operationId); } finally { writer.close(); }
    const afterIndependentWrite = isolated.snapshot();
    expect(afterIndependentWrite).not.toEqual(isolated.original);
    current(token!, isolated.request); // still live: rejection must reload the backend
    await expect(unseal(token!, isolated.request)).rejects.toThrow();
    expect(isolated.snapshot()).toEqual(afterIndependentWrite);
  }, 15000);
  it("rejects expired tokens using captured monotonic time despite delayed event-loop timers", async () => {
    respond(available()); const token = await compose(endpoint)(f.request); expect(token).not.toBeNull();
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);
    let rejection: unknown;
    try { current(token!, f.request); } catch (error) { rejection = error; }
    expect(rejection).toBeInstanceOf(Error);
    const diagnostic = (rejection as Error).cause as { phase: string; tokenAgeMs: number };
    expect(Object.keys(diagnostic).sort()).toEqual(["phase", "tokenAgeMs"]);
    expect(diagnostic.phase).toBe("readiness-token-freshness"); expect(diagnostic.tokenAgeMs).toBeGreaterThanOrEqual(5000);
    for (const secret of [f.file, f.operation.policy.spend, f.operation.policy.funder, f.operation.operationId, "rawTransaction", "transactionHash"])
      expect(JSON.stringify(diagnostic)).not.toContain(secret);
    await expect(unseal(token!, f.request)).rejects.toThrow();
  }, 10000);
  it("refuses lost HTTP/redirect/oversize and never retries", async () => {
    const scenarios = [(_req: IncomingMessage, res: ServerResponse) => res.destroy(), (_req: IncomingMessage, res: ServerResponse) => { res.statusCode = 302; res.setHeader("Location", endpoint); res.end(); },
      (_req: IncomingMessage, res: ServerResponse) => { res.setHeader("Content-Length", "65537"); res.end(); }];
    for (const handler of scenarios) { balanceHandler = handler; const before = balanceCalls; expect(await compose(endpoint)(f.request)).toBeNull(); expect(balanceCalls - before).toBe(1); }
  });
  it("enforces lower-only total/request deadlines, blocked guards and synchronous guard returns", async () => {
    balanceHandler = () => {}; const before = balanceCalls;
    expect(await compose(endpoint, { totalDeadlineMs: 5000, requestDeadlineMs: 100 })(f.request)).toBeNull(); expect(balanceCalls - before).toBe(1);
    respond(available()); let armed = false;
    balanceHandler = (_req, res) => { armed = true; res.end(JSON.stringify(available())); };
    const beforeBlocked = balanceCalls;
    expect(await compose(endpoint, { totalDeadlineMs: 5000, requestDeadlineMs: 100 })({ ...f.request, assertCurrentAuthority: () => { if (armed) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); } })).toBeNull();
    expect(balanceCalls - beforeBlocked).toBe(1);
    expect(await compose(endpoint)({ ...f.request, assertCurrentAuthority: (() => Promise.resolve()) as unknown as () => void })).toBeNull();
    expect(() => compose(endpoint, { totalDeadlineMs: 15001, requestDeadlineMs: 5000 })).toThrow(); expect(() => compose(endpoint, { totalDeadlineMs: 15000, requestDeadlineMs: 5001 })).toThrow();
    for (const url of [endpoint.replace("127.0.0.1", "localhost"), endpoint + "?key=secret", endpoint.replace("http:", "https:"), endpoint.replace("/v1/balances", "/")]) expect(() => compose(url)).toThrow();
  });
  it("counts the initial blocking guard in total elapsed time before any HTTP", async () => {
    respond(available()); let first = true, inspections = 0; const before = balanceCalls;
    const ledger = new Proxy({} as GatewayFundingLedger, { get(_target, property) {
      const value = Reflect.get(f.request.ledger, property);
      if (String(property).startsWith("inspect")) return (...args: unknown[]) => { inspections++; return Reflect.apply(value, f.request.ledger, args); };
      return typeof value === "function" ? value.bind(f.request.ledger) : value;
    } });
    const request = { ...f.request, ledger, assertCurrentAuthority: () => { if (first) { first = false; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2600); } } };
    expect(await compose(endpoint, { totalDeadlineMs: 2500, requestDeadlineMs: 2500 })(request)).toBeNull();
    expect(balanceCalls).toBe(before); expect(inspections).toBe(0);
  });
});
