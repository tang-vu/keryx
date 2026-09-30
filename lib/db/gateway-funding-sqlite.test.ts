import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { provisionSyntheticStorage } from "./storage-identity-fixture";
import { inspectGatewayFundingSqliteOwnerTarget, installGatewayFundingSqliteOwnerAuthorization,
  installGatewayFundingSqliteOwnerPolicy, openGatewayFundingSqliteLedger, openGatewayFundingSqliteTerminalObserver } from "./gateway-funding-sqlite";
import { fundingAggregate, FUNDING_UINT_MAX } from "./gateway-funding-ledger-validation";
import type { GatewayFundingOperation } from "../payments/gateway-funding-policy";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";
import { prepareGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import { validateSignedGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import { createGatewayFundingReceiptObserverForTrustedComposition } from "../payments/gateway-funding-receipt-observer";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../payments/gateway-funding-receipt-policy";
import type { VerifiedFundingTerminalObservation } from "./gateway-funding-ledger-types";
import { scanFullStorageSnapshot } from "./storage-identity-snapshot";

const directories: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
const closedChildren = new WeakSet<ChildProcessWithoutNullStreams>();
afterEach(async () => {
  await Promise.all(children.splice(0).map(process => closedChildren.has(process) ? Promise.resolve()
    : new Promise<void>(resolve => { process.once("close", () => resolve()); process.kill("SIGKILL"); })));
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function fixture(funder = `0x${"1".repeat(40)}`) {
  const dir = mkdtempSync(join(tmpdir(), "funding-ledger-")); directories.push(dir);
  const file = join(dir, "application.sqlite"), identity = await provisionSyntheticStorage(file, "testnet-real");
  const policy = { format: "gateway-funding-policy-v1" as const, identity, policyId: randomUUID(),
    funder, spend: `0x${"2".repeat(40)}`,
    lifetimeLimits: { nativeWei: "100", usdcMicros: "200", depositMicros: "200", gasWei: "800" },
    maxTransactionGas: "10", maxFeePerGasWei: "20" };
  const installation = { format: "gateway-funding-owner-installation-v1" as const, policy,
    funderGasBudgetWei: "400", spendGasBudgetWei: "400", ...await inspectGatewayFundingSqliteOwnerTarget(file, identity),
    finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST, history: { format: "gateway-funding-empty-isolated-history-v1" as const,
      documentDigest: "d".repeat(64), funderInitialNonce: "0" as const, spendInitialNonce: "0" as const } };
  await installGatewayFundingSqliteOwnerPolicy(file, identity, installation);
  const operation: GatewayFundingOperation = { format: "gateway-funding-operation-v1", policy,
    operationId: randomUUID(), ownerAuthorizationId: randomUUID(), ownerAuthorizationDigest: "b".repeat(64),
    minimumAvailableMicros: "100", initialAvailableMicros: "0", nativeTransferWei: "50", usdcTransferMicros: "100",
    approvalMicros: "100", depositMicros: "100", gasLimits: { nativeTransfer: "10", usdcTransfer: "10", approval: "10", deposit: "10" },
    maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1" };
  await installGatewayFundingSqliteOwnerAuthorization(file, identity, operation);
  return { file, identity, policy, installation, operation };
}
async function child(input: object) {
  const process = spawn(globalThis.process.execPath, ["--import", "tsx", fileURLToPath(new URL("./gateway-funding-sqlite-test-child.ts", import.meta.url)), JSON.stringify(input)],
    { env: { NODE_ENV: "test", PATH: globalThis.process.env.PATH, SystemRoot: globalThis.process.env.SystemRoot }, stdio: "pipe" });
  children.push(process); process.once("close", () => closedChildren.add(process)); let text = "";
  let ready!: () => void, failReady!: (error: Error) => void, failResult!: (error: Error) => void;
  let result!: (value: { ok: boolean; result?: { fresh?: boolean; cryptoClaimId?: string }; signatures: number; sends: number }) => void;
  const readyPromise = new Promise<void>((resolve, reject) => { ready = resolve; failReady = reject; });
  const resultPromise = new Promise<{ ok: boolean; result?: { fresh?: boolean; cryptoClaimId?: string }; signatures: number; sends: number }>((resolve, reject) => { result = resolve; failResult = reject; });
  void resultPromise.catch(() => {});
  let received = false, stderrBytes = 0;
  process.stderr.on("data", bytes => { stderrBytes += bytes.length; }); // report count only, never raw child payload/path errors
  const failure = () => { const error = new Error(`Synthetic ledger child failed (${stderrBytes} diagnostic bytes)`); failReady(error); failResult(error); };
  const deadline = setTimeout(() => { failure(); process.kill("SIGKILL"); }, 15000);
  process.once("error", failure); process.once("exit", () => { clearTimeout(deadline); if (!received) failure(); });
  process.stdout.on("data", bytes => { text += bytes.toString(); if (text.includes("READY\n")) ready();
    const match = text.match(/RESULT (.*)\n/); if (match && !received) { received = true; clearTimeout(deadline); result(JSON.parse(match[1])); } });
  await readyPromise;
  return { process, start: () => process.stdin.write("GO\n"), result: resultPromise };
}
describe("identity-bound SQLite funding ledger", () => {
  it("includes every funding payload in full-store CAS and refuses populated legacy enrollment", () => {
    const db = new DatabaseSync(":memory:"); // native unfenced legacy intake, never authority fixture
    try { db.exec("CREATE TABLE gateway_funding_prepared(data TEXT); INSERT INTO gateway_funding_prepared VALUES('original signed bytes')");
      const first = scanFullStorageSnapshot(db); expect(first.enrollmentRefusal).toBeDefined();
      db.exec("UPDATE gateway_funding_prepared SET data='changed unselected signed bytes'");
      const second = scanFullStorageSnapshot(db); expect(second.snapshotDigest).not.toBe(first.snapshotDigest);
      expect(second.enrollmentRefusal).toBeDefined();
    } finally { db.close(); }
  });
  it.each(["success", "reverted"])("requires actual opaque issuer evidence, preserves immutable terminal %s and releases only consumed nonce", async status => {
    const account = privateKeyToAccount(generatePrivateKey()), f = await fixture(account.address.toLowerCase());
    const ledger = openGatewayFundingSqliteLedger(f.file, f.identity), protectedStore = openGatewayFundingSqliteTerminalObserver(f.file, f.identity);
    try {
      await ledger.admitOperation(f.operation.operationId); const reservation = await ledger.reserveStep(f.operation.operationId, "nativeTransfer", "0");
      const cryptoClaimId = randomUUID(), broadcastClaimId = randomUUID();
      await ledger.claimCrypto(f.operation.operationId, "nativeTransfer", cryptoClaimId);
      const rawTransaction = await account.signTransaction(parseTransaction(reservation.transaction.serializedUnsigned));
      const prepared = await validateSignedGatewayFundingTransaction(f.operation, "nativeTransfer", "0", { rawTransaction, transactionHash: keccak256(rawTransaction) }, () => {});
      await ledger.savePrepared(f.operation.operationId, "nativeTransfer", cryptoClaimId, { rawTransaction: prepared.rawTransaction, transactionHash: prepared.transactionHash });
      await ledger.claimBroadcast(f.operation.operationId, "nativeTransfer", broadcastClaimId);
      await expect(protectedStore.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", {} as VerifiedFundingTerminalObservation)).rejects.toThrow();
      const tx = prepared.transaction, signature = parseTransaction(rawTransaction), now = 1800000000000;
      const q = (value: string | number) => `0x${BigInt(value).toString(16)}`;
      const blockHash = `0x${"a".repeat(64)}`, anchorHash = `0x${"b".repeat(64)}`;
      let receiptStatus = status;
      const fetchRead = async (_: RequestInfo | URL, options?: RequestInit) => {
        const { method, params, id } = JSON.parse(options!.body as string); let result: unknown;
        if (method === "eth_chainId") result = q(5042002);
        else if (method === "eth_getTransactionByHash") result = { hash: prepared.transactionHash, from: tx.sender, to: tx.to, input: tx.data, type: "0x2", chainId: q(tx.chainId), nonce: q(tx.nonce), value: q(tx.valueWei), gas: q(tx.gas), maxFeePerGas: q(tx.maxFeePerGasWei), maxPriorityFeePerGas: q(tx.maxPriorityFeePerGasWei), accessList: [], r: signature.r, s: signature.s, yParity: q(signature.yParity!), blockNumber: "0xa", blockHash, transactionIndex: "0x0" };
        else if (method === "eth_getTransactionReceipt") result = { transactionHash: prepared.transactionHash, from: tx.sender, to: tx.to, type: "0x2", status: receiptStatus === "success" ? "0x1" : "0x0", gasUsed: "0x2", effectiveGasPrice: "0x2", blockNumber: "0xa", blockHash, transactionIndex: "0x0" };
        else if (method === "eth_getBlockByNumber") result = params[0] === "0xa" ? { number: "0xa", hash: blockHash, timestamp: q(now / 1000 - 2), transactions: [prepared.transactionHash] } : { number: "0xb", hash: anchorHash, timestamp: q(now / 1000 - 1), transactions: [] };
        else throw new Error("No write RPC supported");
        return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
      };
      const token = await createGatewayFundingReceiptObserverForTrustedComposition(fetchRead, () => now)({ operation: f.operation, prepared, cryptoClaimId, broadcastClaimId, finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST }, () => {});
      expect(token).not.toBeNull();
      await protectedStore.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", token!);
      await protectedStore.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", token!);
      receiptStatus = status === "success" ? "reverted" : "success";
      const conflict = await createGatewayFundingReceiptObserverForTrustedComposition(fetchRead, () => now)({ operation: f.operation, prepared, cryptoClaimId, broadcastClaimId, finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST }, () => {});
      await expect(protectedStore.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", conflict!)).rejects.toThrow();
      const snapshot = await ledger.inspectReservation(f.operation.operationId, "nativeTransfer");
      expect(snapshot?.state).toBe(status === "success" ? "finalized-success" : "finalized-reverted"); expect(snapshot?.terminal?.receiptStatus).toBe(status);
      expect((await ledger.inspectNamespace(f.policy.funder)).used.nativeWei).toBe("50"); // no exposure release on revert
      const second = { ...f.operation, operationId: randomUUID(), ownerAuthorizationId: randomUUID() };
      await installGatewayFundingSqliteOwnerAuthorization(f.file, f.identity, second); await ledger.admitOperation(second.operationId);
      await ledger.reserveStep(second.operationId, "nativeTransfer", "1");
      expect((await ledger.claimCrypto(second.operationId, "nativeTransfer", randomUUID())).fresh).toBe(true);
    } finally { protectedStore.close(); ledger.close(); }
  }, 20000);
  it("refuses missing installation, wrong identity and offline authority without changing the store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "funding-uninstalled-")); directories.push(dir);
    const file = join(dir, "application.sqlite"), identity = await provisionSyntheticStorage(file, "testnet-real");
    const before = await inspectGatewayFundingSqliteOwnerTarget(file, identity);
    expect(() => openGatewayFundingSqliteLedger(file, identity)).toThrow();
    expect(await inspectGatewayFundingSqliteOwnerTarget(file, identity)).toEqual(before);
    const f = await fixture(), snapshot = await inspectGatewayFundingSqliteOwnerTarget(f.file, f.identity);
    expect(() => openGatewayFundingSqliteLedger(f.file, { ...f.identity, storageId: randomUUID() })).toThrow();
    expect(() => openGatewayFundingSqliteLedger(f.file, { ...f.identity, authorityMode: "testnet-offline" })).toThrow();
    expect(await inspectGatewayFundingSqliteOwnerTarget(f.file, f.identity)).toEqual(snapshot);
    const changed = { ...f.installation, finalityPolicyDigest: "f".repeat(64), ...snapshot };
    await expect(installGatewayFundingSqliteOwnerPolicy(f.file, f.identity, changed)).rejects.toThrow();
    expect(await inspectGatewayFundingSqliteOwnerTarget(f.file, f.identity)).toEqual(snapshot);
  });
  it("retains exact prepared signed bytes after process kill; keyless restart cannot acquire fresh send permission", async () => {
    const account = privateKeyToAccount(generatePrivateKey()), f = await fixture(account.address.toLowerCase());
    const ledger = openGatewayFundingSqliteLedger(f.file, f.identity), claimId = randomUUID();
    await ledger.admitOperation(f.operation.operationId); await ledger.reserveStep(f.operation.operationId, "nativeTransfer", "0");
    await ledger.claimCrypto(f.operation.operationId, "nativeTransfer", claimId); ledger.close();
    const dto = prepareGatewayFundingTransaction(f.operation, "nativeTransfer", "0");
    const rawTransaction = await account.signTransaction(parseTransaction(dto.serializedUnsigned));
    const signed = { rawTransaction, transactionHash: keccak256(rawTransaction) };
    const writer = await child({ file: f.file, identity: f.identity, action: "prepared", operationId: f.operation.operationId, claimId, signed, hold: true });
    writer.start(); expect((await writer.result).ok).toBe(true);
    await new Promise<void>(resolve => { writer.process.once("close", () => resolve()); writer.process.kill("SIGKILL"); });
    const recovered = openGatewayFundingSqliteLedger(f.file, f.identity);
    try {
      expect((await recovered.inspectReservation(f.operation.operationId, "nativeTransfer"))?.prepared?.rawTransaction).toBe(rawTransaction);
      const sendId = randomUUID(); expect((await recovered.claimBroadcast(f.operation.operationId, "nativeTransfer", sendId)).fresh).toBe(true);
      expect((await recovered.claimBroadcast(f.operation.operationId, "nativeTransfer", sendId)).fresh).toBe(false);
      await expect(recovered.claimBroadcast(f.operation.operationId, "nativeTransfer", randomUUID())).rejects.toThrow();
      const observation = { format: "gateway-funding-candidate-observation-v1" as const, observationId: randomUUID(), operationId: f.operation.operationId,
        step: "nativeTransfer" as const, transactionHash: signed.transactionHash, status: "unknown" as const,
        observedAt: "2026-10-01T00:00:00.000Z", evidenceDigest: "a".repeat(64) };
      await recovered.appendCandidateObservation(observation);
      expect((await recovered.inspectReservation(f.operation.operationId, "nativeTransfer"))?.state).toBe("unresolved");
      await expect(recovered.appendCandidateObservation({ ...observation, status: "terminal" as never })).rejects.toThrow();
    } finally { recovered.close(); }
  }, 20000);
  it("atomically admits only one operation competing for the last budget across OS processes", async () => {
    const f = await fixture();
    const second = { ...f.operation, operationId: randomUUID(), ownerAuthorizationId: randomUUID(), nativeTransferWei: "100" };
    await installGatewayFundingSqliteOwnerAuthorization(f.file, f.identity, second);
    const [a, b] = await Promise.all([child({ ...f, action: "admit", operationId: f.operation.operationId }),
      child({ ...f, action: "admit", operationId: second.operationId })]); a.start(); b.start();
    const outcomes = await Promise.all([a.result, b.result]); expect(outcomes.filter(r => r.ok)).toHaveLength(1);
    const ledger = openGatewayFundingSqliteLedger(f.file, f.identity);
    try { const ns = await ledger.inspectNamespace(f.policy.funder);
      expect(ns.used).toEqual({ nativeWei: outcomes[0].ok ? "50" : "100", usdcMicros: "100", depositMicros: "0", gasWei: "200" });
      expect(ns.nextNonce).toBe("0"); }
    finally { ledger.close(); }
  }, 20000);
  it("allows exactly one different operation to reserve the same sender's original nonce", async () => {
    const f = await fixture(), second = { ...f.operation, operationId: randomUUID(), ownerAuthorizationId: randomUUID() };
    await installGatewayFundingSqliteOwnerAuthorization(f.file, f.identity, second);
    const ledger = openGatewayFundingSqliteLedger(f.file, f.identity);
    await ledger.admitOperation(f.operation.operationId); await ledger.admitOperation(second.operationId); ledger.close();
    const [a, b] = await Promise.all([child({ file: f.file, identity: f.identity, action: "reserve", operationId: f.operation.operationId }),
      child({ file: f.file, identity: f.identity, action: "reserve", operationId: second.operationId })]); a.start(); b.start();
    const results = await Promise.all([a.result, b.result]); expect(results.filter(r => r.ok)).toHaveLength(1);
    const recovered = openGatewayFundingSqliteLedger(f.file, f.identity);
    try { expect((await recovered.inspectNamespace(f.policy.funder)).nextNonce).toBe("1");
      expect(await recovered.inspectReservation(results[0].ok ? second.operationId : f.operation.operationId, "nativeTransfer")).toBeNull();
    } finally { recovered.close(); }
  }, 20000);
  it("races original nonce and crypto claim, then recovers after actual process kill without signing or sending", async () => {
    const f = await fixture(), ledger = openGatewayFundingSqliteLedger(f.file, f.identity);
    await ledger.admitOperation(f.operation.operationId); ledger.close();
    const [a, b] = await Promise.all([child({ file: f.file, identity: f.identity, action: "reserve", operationId: f.operation.operationId }),
      child({ file: f.file, identity: f.identity, action: "reserve", operationId: f.operation.operationId })]); a.start(); b.start();
    expect((await Promise.all([a.result, b.result])).every(r => r.ok)).toBe(true); // exact immutable reserve replay
    const claimId = randomUUID();
    const beforeClaim = await child({ file: f.file, identity: f.identity, action: "claim", operationId: f.operation.operationId, claimId });
    await new Promise<void>(resolve => { beforeClaim.process.once("close", () => resolve()); beforeClaim.process.kill("SIGKILL"); });
    const untouched = openGatewayFundingSqliteLedger(f.file, f.identity, { readOnly: true });
    try { expect((await untouched.inspectReservation(f.operation.operationId, "nativeTransfer"))?.state).toBe("reserved"); }
    finally { untouched.close(); }
    const [c, d] = await Promise.all([child({ file: f.file, identity: f.identity, action: "claim", operationId: f.operation.operationId, claimId, hold: true }),
      child({ file: f.file, identity: f.identity, action: "claim", operationId: f.operation.operationId, claimId, hold: true })]); c.start(); d.start();
    const claims = await Promise.all([c.result, d.result]); expect(claims.filter(r => r.result?.fresh)).toHaveLength(1);
    const exits = [c.process, d.process].map(p => new Promise<void>(resolve => { p.once("close", () => resolve()); p.kill("SIGKILL"); })); await Promise.all(exits);
    const recovered = await child({ file: f.file, identity: f.identity, action: "inspect", operationId: f.operation.operationId }); recovered.start();
    const snapshot = await recovered.result; expect(snapshot.result?.cryptoClaimId).toBe(claimId);
    expect(snapshot.signatures).toBe(0); expect(snapshot.sends).toBe(0);
  }, 20000);
  it("requires owner installation, preserves exact repeats and aggregate currency exposure", async () => {
    const f = await fixture(), ledger = openGatewayFundingSqliteLedger(f.file, f.identity);
    try {
      expect(await installGatewayFundingSqliteOwnerPolicy(f.file, f.identity, f.installation)).toEqual({ installed: false });
      await expect(ledger.admitOperation(randomUUID())).rejects.toThrow();
      await ledger.admitOperation(f.operation.operationId); await ledger.admitOperation(f.operation.operationId);
      const funder = await ledger.inspectNamespace(f.policy.funder), spend = await ledger.inspectNamespace(f.policy.spend);
      expect(funder.nativeAggregateUsedWei).toBe("100000000000250");
      expect(spend.nativeAggregateUsedWei).toBe("100000000000200");
      expect(funder.used.usdcMicros).toBe("100");
    } finally { ledger.close(); }
  });
  it("never reopens an irreversible crypto claim or original nonce on restart", async () => {
    const f = await fixture(), first = openGatewayFundingSqliteLedger(f.file, f.identity), claim = randomUUID();
    await first.admitOperation(f.operation.operationId); await first.reserveStep(f.operation.operationId, "nativeTransfer", "0");
    expect((await first.claimCrypto(f.operation.operationId, "nativeTransfer", claim)).fresh).toBe(true); first.close();
    const recovered = openGatewayFundingSqliteLedger(f.file, f.identity, { readOnly: true });
    try { expect((await recovered.inspectReservation(f.operation.operationId, "nativeTransfer"))?.cryptoClaimId).toBe(claim);
      expect((await recovered.inspectNamespace(f.policy.funder)).nextNonce).toBe("1");
    } finally { recovered.close(); }
    const writable = openGatewayFundingSqliteLedger(f.file, f.identity);
    try { expect((await writable.claimCrypto(f.operation.operationId, "nativeTransfer", claim)).fresh).toBe(false);
      await expect(writable.claimCrypto(f.operation.operationId, "nativeTransfer", randomUUID())).rejects.toThrow();
      await writable.reserveStep(f.operation.operationId, "usdcTransfer", "1");
      await expect(writable.claimCrypto(f.operation.operationId, "usdcTransfer", randomUUID())).rejects.toThrow();
    } finally { writable.close(); }
  });
  it("refuses copied physical stores and raw policy/history changes", async () => {
    const f = await fixture(), copy = join(directories.at(-1)!, "copy.sqlite"); copyFileSync(f.file, copy);
    expect(() => openGatewayFundingSqliteLedger(copy, f.identity)).toThrow();
    const raw = new DatabaseSync(f.file);
    try { expect(() => raw.exec("DELETE FROM gateway_funding_namespaces")).toThrow();
      expect(() => raw.exec("INSERT INTO gateway_funding_policies VALUES('forged','{}')")).toThrow();
    } finally { raw.close(); }
    const ledger = openGatewayFundingSqliteLedger(f.file, f.identity); ledger.close();
  });
  it("refuses micros conversion overflow rather than rounding or independent-currency accounting", () => {
    expect(fundingAggregate({ nativeWei: "1", usdcMicros: "2", depositMicros: "0", gasWei: "3" })).toBe("2000000000004");
    expect(() => fundingAggregate({ nativeWei: "0", usdcMicros: FUNDING_UINT_MAX.toString(), depositMicros: "0", gasWei: "0" })).toThrow();
  });
});
