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
import { fundingAggregate, FUNDING_UINT_MAX, validateFundingNamespace } from "./gateway-funding-ledger-validation";
import type { GatewayFundingOperation } from "../payments/gateway-funding-policy";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";
import { prepareGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import { validateSignedGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import { createGatewayFundingReceiptObserverForTrustedComposition } from "../payments/gateway-funding-receipt-observer";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../payments/gateway-funding-receipt-policy";
import type { VerifiedFundingTerminalObservation } from "./gateway-funding-ledger-types";
import { scanFullStorageSnapshot } from "./storage-identity-snapshot";
import { registerStorageCapability } from "./storage-identity-sqlite";
import { syntheticFundingTerminal } from "./gateway-funding-sqlite-test-receipt";
import { canonicalJson } from "../canonical-json";
import { GATEWAY_FUNDING_INDEXES } from "./gateway-funding-sqlite-schema";

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
  let ready!: () => void, failReady!: (error: Error) => void, failResult!: (error: Error) => void, point!: () => void, failPoint!: (error: Error) => void;
  let result!: (value: { ok: boolean; result?: { fresh?: boolean; cryptoClaimId?: string }; signatures: number; sends: number }) => void;
  const readyPromise = new Promise<void>((resolve, reject) => { ready = resolve; failReady = reject; });
  const resultPromise = new Promise<{ ok: boolean; result?: { fresh?: boolean; cryptoClaimId?: string }; signatures: number; sends: number }>((resolve, reject) => { result = resolve; failResult = reject; });
  void resultPromise.catch(() => {});
  const pointPromise = new Promise<void>((resolve, reject) => { point = resolve; failPoint = reject; }); void pointPromise.catch(() => {});
  let received = false, stderrBytes = 0, stage = "unknown", category = "unknown";
  process.stderr.on("data", bytes => { stderrBytes += bytes.length; }); // report count only, never raw child payload/path errors
  const failure = (status: number | null = null, signal: string | null = null) => {
    const safeSignal = signal === null ? "none" : ["SIGKILL", "SIGTERM", "SIGABRT", "SIGSEGV"].includes(signal) ? signal : "other";
    const error = new Error(`Synthetic ledger child failed stage=${stage} category=${category} status=${status ?? "none"} signal=${safeSignal} (${stderrBytes} diagnostic bytes)`);
    failReady(error); failResult(error); failPoint(error);
  };
  const deadline = setTimeout(() => { stage = "deadline"; failure(); process.kill("SIGKILL"); }, 15000);
  process.once("error", () => { category = "spawn"; failure(); }); process.once("exit", (code, signal) => { clearTimeout(deadline); if (!received) failure(code, signal); });
  process.stdout.on("data", bytes => { text += bytes.toString(); if (text.includes("READY\n")) ready();
    if (text.includes("POINT\n")) point();
    if (text.includes('FAILURE {"stage":"admission","category":"refused"}\n')) { stage = "admission"; category = "refused"; failure(); }
    const match = text.match(/RESULT (.*)\n/); if (match && !received) { received = true; clearTimeout(deadline); result(JSON.parse(match[1])); } });
  await readyPromise;
  return { process, start: () => process.stdin.write("GO\n"), result: resultPromise, point: pointPromise };
}
describe("identity-bound SQLite funding ledger", () => {
  it.each(["admit", "reserve"] as const)("reports %s native admission failure before READY/GO under an exclusive lock without treating it as an operation loser", async action => {
    const f = await fixture(), ledger = openGatewayFundingSqliteLedger(f.file, f.identity);
    await ledger.admitOperation(f.operation.operationId); ledger.close();
    const native = new DatabaseSync(f.file);
    try {
      const before = scanFullStorageSnapshot(native);
      native.exec("BEGIN EXCLUSIVE");
      // An explicit exclusive lock demonstrates admission failure. It is not
      // claimed equivalent to the production reservation's BEGIN IMMEDIATE.
      await expect(child({ file: f.file, identity: f.identity, action, operationId: f.operation.operationId }))
        .rejects.toThrow("stage=admission category=refused");
      native.exec("ROLLBACK");
      expect(scanFullStorageSnapshot(native)).toEqual(before);
    } finally { if (native.isTransaction) native.exec("ROLLBACK"); native.close(); }
  }, 20000);
  it.each(["missing", "modified"])("uses an exact covering observation index and refuses %s index without repair", async kind => {
    const f = await fixture(), db = new DatabaseSync(f.file);
    try {
      const plan = db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM gateway_funding_observations WHERE operation_id=? AND step=? AND kind='unknown' LIMIT 1").all(f.operation.operationId, "nativeTransfer");
      expect(plan.map(row => row.detail).join(" ")).toContain("SEARCH gateway_funding_observations USING COVERING INDEX gateway_funding_observations_slot_kind (operation_id=? AND step=? AND kind=?)");
      db.exec("DROP INDEX gateway_funding_observations_slot_kind");
      if (kind === "modified") db.exec("CREATE INDEX gateway_funding_observations_slot_kind ON gateway_funding_observations(kind,step,operation_id)");
      const before = db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all();
      expect(() => openGatewayFundingSqliteLedger(f.file, f.identity)).toThrow();
      expect(() => openGatewayFundingSqliteTerminalObserver(f.file, f.identity)).toThrow();
      await expect(installGatewayFundingSqliteOwnerPolicy(f.file, f.identity, f.installation)).rejects.toThrow();
      expect(db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all()).toEqual(before);
      expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='gateway_funding_observations_slot_kind'").get()?.sql).not.toBe(GATEWAY_FUNDING_INDEXES.gateway_funding_observations_slot_kind);
    } finally { db.close(); }
  });
  it("serializes protected terminal and a later crypto claim across OS processes without changing reservation highwater or exposure", async () => {
    const account = privateKeyToAccount(generatePrivateKey()), f = await fixture(account.address.toLowerCase());
    const second = { ...f.operation, operationId: randomUUID(), ownerAuthorizationId: randomUUID() };
    await installGatewayFundingSqliteOwnerAuthorization(f.file, f.identity, second);
    const ledger = openGatewayFundingSqliteLedger(f.file, f.identity), cryptoClaimId = randomUUID(), broadcastClaimId = randomUUID();
    await ledger.admitOperation(f.operation.operationId); await ledger.admitOperation(second.operationId);
    const first = await ledger.reserveStep(f.operation.operationId, "nativeTransfer", "0");
    await ledger.reserveStep(second.operationId, "nativeTransfer", "1");
    const laterClaim = randomUUID(); await expect(ledger.claimCrypto(second.operationId, "nativeTransfer", laterClaim)).rejects.toThrow();
    await ledger.claimCrypto(f.operation.operationId, "nativeTransfer", cryptoClaimId);
    const rawTransaction = await account.signTransaction(parseTransaction(first.transaction.serializedUnsigned));
    await ledger.savePrepared(f.operation.operationId, "nativeTransfer", cryptoClaimId, { rawTransaction, transactionHash: keccak256(rawTransaction) });
    await ledger.claimBroadcast(f.operation.operationId, "nativeTransfer", broadcastClaimId);
    const original = await ledger.inspectNamespace(f.policy.funder); ledger.close();
    const [terminal, claim] = await Promise.all([child({ file: f.file, identity: f.identity, action: "terminal", operationId: f.operation.operationId }),
      child({ file: f.file, identity: f.identity, action: "claim", operationId: second.operationId, claimId: laterClaim })]); terminal.start(); claim.start();
    const [terminalResult, claimResult] = await Promise.all([terminal.result, claim.result]); expect(terminalResult.ok).toBe(true);
    const recovered = openGatewayFundingSqliteLedger(f.file, f.identity);
    try { expect(await recovered.inspectNamespace(f.policy.funder)).toEqual({ ...original, nextCryptoNonce: "1" });
      // A loser before terminal CAS owns nothing; explicit post-terminal admission
      // is distinct from an automatic replay of an exposed crypto/send claim.
      expect((await recovered.claimCrypto(second.operationId, "nativeTransfer", laterClaim)).fresh).toBe(!claimResult.ok);
      expect((await recovered.inspectReservation(f.operation.operationId, "nativeTransfer"))?.state).toBe("finalized-success");
    } finally { recovered.close(); }
  }, 20000);
  it.each(["after-terminal-insert", "before-terminal-commit", "after-terminal-commit"])("keeps terminal and nonce barrier atomic after actual kill at %s", async point => {
    const account = privateKeyToAccount(generatePrivateKey()), f = await fixture(account.address.toLowerCase());
    const ledger = openGatewayFundingSqliteLedger(f.file, f.identity), cryptoClaimId = randomUUID(), broadcastClaimId = randomUUID();
    await ledger.admitOperation(f.operation.operationId); const slot = await ledger.reserveStep(f.operation.operationId, "nativeTransfer", "0");
    await ledger.claimCrypto(f.operation.operationId, "nativeTransfer", cryptoClaimId);
    const rawTransaction = await account.signTransaction(parseTransaction(slot.transaction.serializedUnsigned));
    await ledger.savePrepared(f.operation.operationId, "nativeTransfer", cryptoClaimId, { rawTransaction, transactionHash: keccak256(rawTransaction) });
    await ledger.claimBroadcast(f.operation.operationId, "nativeTransfer", broadcastClaimId);
    const original = await ledger.inspectNamespace(f.policy.funder); ledger.close();
    const writer = await child({ file: f.file, identity: f.identity, action: "terminal", operationId: f.operation.operationId, point }); writer.start(); await writer.point;
    await new Promise<void>(resolve => { writer.process.once("close", () => resolve()); writer.process.kill("SIGKILL"); });
    const recovered = openGatewayFundingSqliteLedger(f.file, f.identity);
    try { const namespace = await recovered.inspectNamespace(f.policy.funder), snapshot = await recovered.inspectReservation(f.operation.operationId, "nativeTransfer");
      const committed = point === "after-terminal-commit";
      expect(namespace).toEqual({ ...original, nextCryptoNonce: committed ? "1" : "0" });
      expect(snapshot?.state).toBe(committed ? "finalized-success" : "pending");
      expect(Boolean(snapshot?.terminal)).toBe(committed);
      expect(snapshot?.prepared?.rawTransaction).toBe(rawTransaction);
      expect(snapshot?.cryptoClaimId).toBe(cryptoClaimId); expect(snapshot?.broadcastClaimId).toBe(broadcastClaimId);
      expect((await recovered.claimCrypto(f.operation.operationId, "nativeTransfer", cryptoClaimId)).fresh).toBe(false);
    } finally { recovered.close(); }
  }, 20000);
  it("refuses missing, future and exhausted barrier corruption without defaulting legacy state", async () => {
    const f = await fixture(), ledger = openGatewayFundingSqliteLedger(f.file, f.identity);
    try { const namespace = await ledger.inspectNamespace(f.policy.funder);
      const missing: Record<string, unknown> = { ...namespace }; delete missing.nextCryptoNonce;
      expect(() => validateFundingNamespace(missing, f.identity, namespace.backendBindingDigest)).toThrow();
      expect(() => validateFundingNamespace({ ...namespace, nextCryptoNonce: "1" }, f.identity, namespace.backendBindingDigest)).toThrow();
      expect(() => validateFundingNamespace({ ...namespace, nextNonce: "9007199254740992", nextCryptoNonce: "9007199254740992" }, f.identity, namespace.backendBindingDigest)).not.toThrow();
      expect(() => validateFundingNamespace({ ...namespace, nextNonce: "9007199254740993", nextCryptoNonce: "9007199254740993" }, f.identity, namespace.backendBindingDigest)).toThrow();
      const legacy: Record<string, unknown> = { ...namespace }; delete legacy.nextCryptoNonce;
      ledger.close();
      // Trusted fixture construction represents the earlier candidate record
      // format. This capability is never supplied to production/raw app callers.
      const oldWriter = new DatabaseSync(f.file);
      try { registerStorageCapability(oldWriter, f.identity, () => true);
        oldWriter.function("keryx_funding_capability", (table, verb) => typeof table === "string" && typeof verb === "string" ? 1 : 0);
        oldWriter.prepare("UPDATE gateway_funding_namespaces SET data=? WHERE sender=?").run(canonicalJson(legacy), f.policy.funder);
      } finally { oldWriter.close(); }
      const before = await inspectGatewayFundingSqliteOwnerTarget(f.file, f.identity);
      expect(() => openGatewayFundingSqliteLedger(f.file, f.identity)).toThrow();
      await expect(installGatewayFundingSqliteOwnerPolicy(f.file, f.identity, f.installation)).rejects.toThrow();
      expect(await inspectGatewayFundingSqliteOwnerTarget(f.file, f.identity)).toEqual(before);
    } finally { ledger.close(); }
  });
  it("preserves lifetime exposure, nonce highwater and claims across owner policy UUID rollover", async () => {
    const account = privateKeyToAccount(generatePrivateKey()), f = await fixture(account.address.toLowerCase());
    const ledger = openGatewayFundingSqliteLedger(f.file, f.identity), claimId = randomUUID();
    await ledger.admitOperation(f.operation.operationId); const slot = await ledger.reserveStep(f.operation.operationId, "nativeTransfer", "0");
    await ledger.claimCrypto(f.operation.operationId, "nativeTransfer", claimId);
    const rawTransaction = await account.signTransaction(parseTransaction(slot.transaction.serializedUnsigned));
    await ledger.savePrepared(f.operation.operationId, "nativeTransfer", claimId, { rawTransaction, transactionHash: keccak256(rawTransaction) });
    await ledger.claimBroadcast(f.operation.operationId, "nativeTransfer", randomUUID());
    const protectedStore = openGatewayFundingSqliteTerminalObserver(f.file, f.identity);
    try { const original = await ledger.inspectReservation(f.operation.operationId, "nativeTransfer");
      await protectedStore.appendVerifiedTerminalObservation(f.operation.operationId, "nativeTransfer", await syntheticFundingTerminal(original!));
    } finally { protectedStore.close(); }
    const original = await ledger.inspectNamespace(f.policy.funder); ledger.close();
    expect(original.nextCryptoNonce).toBe("1");
    const rollover = { ...f.installation, policy: { ...f.policy, policyId: randomUUID() }, ...await inspectGatewayFundingSqliteOwnerTarget(f.file, f.identity) };
    expect(await installGatewayFundingSqliteOwnerPolicy(f.file, f.identity, rollover)).toEqual({ installed: true });
    const snapshot = await inspectGatewayFundingSqliteOwnerTarget(f.file, f.identity);
    for (const changes of [
      { policy: { ...rollover.policy, policyId: randomUUID(), lifetimeLimits: { ...f.policy.lifetimeLimits, nativeWei: "101" } } },
      { policy: { ...rollover.policy, policyId: randomUUID() }, finalityPolicyDigest: "e".repeat(64) },
      { policy: { ...rollover.policy, policyId: randomUUID() }, history: { ...rollover.history, documentDigest: "e".repeat(64) } },
      { policy: { ...rollover.policy, policyId: randomUUID(), spend: `0x${"3".repeat(40)}` } },
    ]) {
      await expect(installGatewayFundingSqliteOwnerPolicy(f.file, f.identity, { ...rollover, ...snapshot, ...changes })).rejects.toThrow();
      expect(await inspectGatewayFundingSqliteOwnerTarget(f.file, f.identity)).toEqual(snapshot);
    }
    const recovered = openGatewayFundingSqliteLedger(f.file, f.identity);
    try { expect(await recovered.inspectNamespace(f.policy.funder)).toEqual(original);
      expect((await recovered.inspectReservation(f.operation.operationId, "nativeTransfer"))?.cryptoClaimId).toBe(claimId);
    } finally { recovered.close(); }
  }, 30000);
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
