/** Isolated, owner-operated Arc testnet rehearsal. Never enables production routes/timers. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, encodeFunctionData, type Hex } from "viem";
import { config } from "../lib/config.ts";
import { prepareWithdrawIntent } from "../lib/gateway/withdraw-intent.ts";
import { withdrawPolicySchema, withdrawTypedData } from "../lib/gateway/withdraw-protocol.ts";
import { createWithdrawalRequest, validateWithdrawalRequest } from "../lib/gateway/withdrawal-request.ts";
import { createWithdrawalBrowserDraft } from "../lib/gateway/withdrawal-browser-journal.ts";
import { estimateWithdrawalIntent } from "../lib/gateway/withdrawal-estimate.ts";
import { withdrawalHeightWindowForRpc } from "../lib/gateway/withdrawal-height-window.ts";
import { inspectWithdrawalRelayDirectory, inspectWithdrawalRelayFiles } from "../lib/gateway/withdrawal-relay-files.ts";
import { createWithdrawalMintJournal } from "../lib/gateway/withdrawal-mint-journal.ts";
import { createWithdrawalRuntimeAdmission } from "../lib/gateway/withdrawal-admission-bootstrap.ts";
import { submitWithdrawalTransfer, requestCircleWithdrawalTransfer, withdrawalTransferProgress } from "../lib/gateway/withdrawal-transfer-service.ts";
import { withdrawalRelayRuntime } from "../lib/gateway/withdrawal-relay-runtime.ts";
import { queueWithdrawalRelayPage } from "../lib/gateway/withdrawal-relay-queue.ts";
import { runWithdrawalRelayWorker, withdrawalRelayDependenciesForRpc } from "../lib/gateway/withdrawal-relay-worker.ts";
import { withdrawalReceiptObserverForRpc } from "../lib/gateway/withdrawal-receipt-observation.ts";
import { WITHDRAWAL_MINTER_ABI } from "../lib/gateway/withdrawal-mint-observation.ts";
import { withdrawalRpcTransport } from "../lib/gateway/withdrawal-rpc-transport.ts";
import { withWithdrawalApplicationStore, withWithdrawalCashOutStore } from "../lib/gateway/withdrawal-application-store.ts";
import { recordObservedWithdrawalCashOut } from "../lib/gateway/withdrawal-cash-out.ts";
import { withPrivateWorkerLock } from "../lib/a2a/private-worker-lock.ts";
import { SqliteAdapter } from "../lib/db/sqlite-adapter.ts";

const { values } = parseArgs({ options: {
  prepare: { type: "boolean" }, sign: { type: "boolean" }, submit: { type: "boolean" },
  "mint-once": { type: "boolean" }, recover: { type: "boolean" },
  directory: { type: "string" }, original: { type: "string" }, owner: { type: "string" },
  "amount-micros": { type: "string" }, "fee-cap-micros": { type: "string" },
  "max-ahead-blocks": { type: "string" }, "max-processing-lag-blocks": { type: "string" },
  "relay-directory": { type: "string" }, "gas-ceiling-wei": { type: "string" },
  gas: { type: "string" }, "max-fee-per-gas": { type: "string" }, "priority-fee-per-gas": { type: "string" },
  "confirm-isolated-custody": { type: "boolean" },
}, strict: true });
const selectedDirectory = values.directory && path.resolve(values.directory);
const signal = AbortSignal.timeout(90000);
function saveExclusive(file: string, data: unknown) {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(data)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  if (process.platform === "linux") {
    const folder = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(folder); } finally { fs.closeSync(folder); }
  }
}
function read(file: string) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function bounds() {
  if (!values["max-ahead-blocks"] || !values["max-processing-lag-blocks"]) throw new Error("Explicit height limits required");
  return { maxAheadBlocks: values["max-ahead-blocks"], maxProcessingLagBlocks: values["max-processing-lag-blocks"] };
}
async function freshTerms(record: Awaited<ReturnType<typeof validateWithdrawalRequest>>) {
  const window = await withdrawalHeightWindowForRpc(config.rpcUrl, record.policy, bounds(), signal);
  const height = BigInt(record.request.burnIntent.maxBlockHeight);
  assert.ok(height >= BigInt(window.minimumBlockHeight) && height <= BigInt(window.maximumBlockHeight));
}
function runtime() {
  if (!values["relay-directory"] || !values["gas-ceiling-wei"] || !values["confirm-isolated-custody"])
    throw new Error("Explicit existing relay, gas ceiling and verified isolated custody required");
  assert.ok(BigInt(values["gas-ceiling-wei"]) > BigInt(0) && BigInt(values["gas-ceiling-wei"]) <= BigInt(9000000000000000));
  // Opt-in applies only to this standalone process; original env files are untouched.
  const env = { ...process.env, KERYX_WITHDRAWAL_RELAY_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ISOLATED: "1",
    KERYX_WITHDRAWAL_RELAY_DIRECTORY: values["relay-directory"] };
  const relay = withdrawalRelayRuntime(env, config.networkId);
  assert.ok(relay);
  return { env, relay };
}
async function main() {
  assert.equal([values.prepare, values.sign, values.submit, values["mint-once"], values.recover].filter(Boolean).length, 1);
  assert.ok(selectedDirectory && path.isAbsolute(selectedDirectory));
  assert.equal(config.networkId, "eip155:5042002");
  assert.equal(config.cctpDomain, 26);
  assert.ok(!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (values.prepare) {
    assert.ok(values.owner && values["amount-micros"] && values["fee-cap-micros"]);
    const policy = withdrawPolicySchema.parse({ owner: values.owner, recipient: values.owner, domain: 26,
      gatewayWallet: config.gatewayWallet, gatewayMinter: config.gatewayMinter, asset: config.usdcAddress,
      maxValueMicros: values["amount-micros"], maxFeeMicros: values["fee-cap-micros"] });
    assert.ok(BigInt(policy.maxValueMicros) > BigInt(0));
    assert.ok(BigInt(policy.maxValueMicros) <= BigInt(2000) && BigInt(policy.maxFeeMicros) <= BigInt(3900));
    const height = await withdrawalHeightWindowForRpc(config.rpcUrl, policy, bounds(), signal);
    const candidate = prepareWithdrawIntent(policy.owner, BigInt(policy.maxValueMicros), policy.recipient);
    candidate.maxFee = policy.maxFeeMicros;
    const intent = await estimateWithdrawalIntent(candidate, policy,
      { minimumBlockHeight: height.minimumBlockHeight, maximumBlockHeight: height.maximumBlockHeight }, signal);
    const draft = createWithdrawalBrowserDraft(intent, policy);
    fs.mkdirSync(selectedDirectory, { mode: 0o700 }); // Never reuse another rehearsal.
    saveExclusive(path.join(selectedDirectory, "draft.json"), draft);
    console.log(JSON.stringify({ state: "unsigned-original-retained", owner: policy.owner, requestId: draft.id,
      amountMicros: intent.spec.value, maxFeeMicros: intent.maxFee, maxBlockHeight: intent.maxBlockHeight, transferPosts: 0 }));
    return;
  }
  if (values.sign) {
    const draft = read(path.join(selectedDirectory, "draft.json"));
    assert.deepEqual(createWithdrawalBrowserDraft(draft.burnIntent, draft.policy), draft);
    const key = process.env.BUYER_PRIVATE_KEY;
    assert.ok(key && /^0x[a-fA-F0-9]{64}$/.test(key));
    const account = privateKeyToAccount(key as Hex);
    assert.equal(account.address.toLowerCase(), draft.owner);
    assert.equal(draft.owner, draft.policy.recipient);
    const height = await withdrawalHeightWindowForRpc(config.rpcUrl, draft.policy, bounds(), signal);
    assert.ok(BigInt(draft.burnIntent.maxBlockHeight) >= BigInt(height.minimumBlockHeight)
      && BigInt(draft.burnIntent.maxBlockHeight) <= BigInt(height.maximumBlockHeight));
    // A lost signing/file response is inspection-only, never another signature.
    saveExclusive(path.join(selectedDirectory, "signing-attempt.json"), { requestId: draft.id });
    const signature = await account.signTypedData(withdrawTypedData(draft.burnIntent));
    const original = await createWithdrawalRequest({ burnIntent: draft.burnIntent, signature }, draft.policy);
    assert.equal(original.id, draft.id);
    saveExclusive(path.join(selectedDirectory, "original.json"), original);
    console.log(JSON.stringify({ state: "signed-original-retained", requestId: original.id, transferPosts: 0 }));
    return;
  }
  if (values.submit) {
    assert.equal(process.platform, "linux");
    assert.ok(values.original);
    const original = await validateWithdrawalRequest(read(path.resolve(values.original)));
    assert.equal(original.owner, original.policy.recipient);
    assert.equal(original.owner, values.owner?.toLowerCase());
    assert.ok(BigInt(original.policy.maxValueMicros) <= BigInt(2000) && BigInt(original.policy.maxFeeMicros) <= BigInt(3900));
    const { env, relay } = runtime();
    const relayFiles = await inspectWithdrawalRelayFiles(relay.directory);
    const journalDb = new DatabaseSync(relayFiles.databasePath, { readOnly: true });
    try {
      const initial = createWithdrawalMintJournal(journalDb, relayFiles.policy as Parameters<typeof createWithdrawalMintJournal>[1]);
      assert.equal(initial.gasAdmissionSummary().committedRequests, 0);
      assert.equal(initial.listRequestIds().length, 0);
    } finally { journalDb.close(); }
    await inspectWithdrawalRelayDirectory(path.dirname(selectedDirectory));
    await freshTerms(original);
    fs.mkdirSync(selectedDirectory, { mode: 0o700 });
    const appDirectory = path.join(selectedDirectory, "application");
    fs.mkdirSync(appDirectory, { mode: 0o700 });
    const database = path.join(appDirectory, "keryx.sqlite");
    saveExclusive(path.join(selectedDirectory, "original.json"), original);
    saveExclusive(path.join(selectedDirectory, "metadata.json"), { requestId: original.id, owner: original.owner,
      relayDirectory: relay.directory, database, gasCeilingWei: values["gas-ceiling-wei"] });
    const store = new SqliteAdapter(database);
    fs.chmodSync(database, 0o600);
    try {
      let transferPosts = 0;
      const admit = createWithdrawalRuntimeAdmission(env, config.networkId, config.rpcUrl, values["gas-ceiling-wei"]!);
      await submitWithdrawalTransfer(store, original, original.owner, async (record, current) => {
        await freshTerms(record); await admit(record, current);
      }, async (record, current) => {
        await freshTerms(record);
        const retained = await store.getCreatorWithdrawal(record.id, record.owner);
        assert.deepEqual(retained, original);
        assert.ok(await store.getCreatorWithdrawalTransferClaim(record.id, record.owner));
        assert.equal(++transferPosts, 1);
        saveExclusive(path.join(selectedDirectory, "circle-post-attempt.json"), { requestId: original.id });
        return requestCircleWithdrawalTransfer(record, current);
      }, signal);
      // Intentionally discard the app response, then read durable evidence only.
      const retained = await withdrawalTransferProgress(store, original.id, original.owner);
      saveExclusive(path.join(selectedDirectory, "submit-observation.json"), { transferPosts, retained });
      console.log(JSON.stringify({ state: "app-response-discarded", transferPosts, progress: retained }));
    } finally { store.close(); }
    return;
  }
  assert.equal(process.platform, "linux");
  await inspectWithdrawalRelayDirectory(selectedDirectory);
  const metadata = read(path.join(selectedDirectory, "metadata.json"));
  const original = await validateWithdrawalRequest(read(path.join(selectedDirectory, "original.json")));
  assert.equal(original.id, metadata.requestId); assert.equal(original.owner, metadata.owner);
  assert.equal(metadata.database, path.join(selectedDirectory, "application", "keryx.sqlite"));
  const files = await inspectWithdrawalRelayFiles(metadata.relayDirectory);
  const database = new DatabaseSync(files.databasePath);
  try {
    const journal = createWithdrawalMintJournal(database, files.policy as Parameters<typeof createWithdrawalMintJournal>[1]);
    if (values["mint-once"]) {
      const { relay } = runtime(); assert.equal(relay.directory, files.directory);
      assert.equal(values["gas-ceiling-wei"], metadata.gasCeilingWei);
      assert.ok(values.gas && values["max-fee-per-gas"] && values["priority-fee-per-gas"]);
      assert.ok(BigInt(values.gas) <= BigInt(300000) && BigInt(values["max-fee-per-gas"]) <= BigInt(30000000000));
      const attestation = await withWithdrawalApplicationStore(metadata.database,
        store => store.getCreatorWithdrawalAttestation(original.id, original.owner));
      assert.ok(attestation);
      const client = createPublicClient({ transport: withdrawalRpcTransport(config.rpcUrl, signal) });
      assert.equal(await client.getChainId(), 5042002);
      const current = await client.getBlock({ blockTag: "latest" });
      assert.ok(current.baseFeePerGas !== null && current.baseFeePerGas !== undefined
        && current.baseFeePerGas <= BigInt(values["max-fee-per-gas"]));
      const estimatedGas = await client.estimateGas({ account: relay.signer.address,
        to: original.policy.gatewayMinter, value: BigInt(0), maxFeePerGas: BigInt(values["max-fee-per-gas"]),
        maxPriorityFeePerGas: BigInt(values["priority-fee-per-gas"]),
        data: encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint",
          args: [attestation.attestation, attestation.signature] }) });
      assert.ok(estimatedGas <= BigInt(values.gas));
      saveExclusive(path.join(selectedDirectory, "mint-pass-attempt.json"), { requestId: original.id });
      const queued = await withWithdrawalApplicationStore(metadata.database, store =>
        queueWithdrawalRelayPage(files.directory, journal, store, { relayer: relay.signer.address,
          gas: values.gas!, maxFeePerGas: values["max-fee-per-gas"]!,
          maxPriorityFeePerGas: values["priority-fee-per-gas"]!, gasBudgetWei: metadata.gasCeilingWei }, signal, { limit: 1 }));
      assert.equal(queued.unavailable, 0);
      assert.deepEqual(journal.listRequestIds(), [original.id]);
      const dependencies = withdrawalRelayDependenciesForRpc(config.rpcUrl, signal);
      const send = dependencies.client.sendRawTransaction.bind(dependencies.client);
      let actualBroadcasts = 0;
      dependencies.client.sendRawTransaction = async request => {
        assert.equal(++actualBroadcasts, 1);
        const saved = await journal.getPrepared(original.id);
        assert.ok(saved); assert.equal(saved.serializedTransaction, request.serializedTransaction);
        saveExclusive(path.join(selectedDirectory, "mint-broadcast-attempt.json"), { requestId: original.id, transactionHash: saved.transactionHash });
        await send(request);
        throw new Error("Operator rehearsal intentionally discarded original RPC response");
      };
      const result = await runWithdrawalRelayWorker(files.directory, journal, relay.signer, relay.otherSigners, dependencies, signal, 1);
      const saved = await journal.getPrepared(original.id);
      saveExclusive(path.join(selectedDirectory, "mint-observation.json"), { result, actualBroadcasts, transactionHash: saved?.transactionHash });
      console.log(JSON.stringify({ state: "mint-response-discarded", result, actualBroadcasts, transactionHash: saved?.transactionHash }));
      return;
    }
    // Recovery has no signer construction, Circle POST or sendRawTransaction capability.
    const result = await withPrivateWorkerLock(files.directory, () => journal.reconcile(original.id,
      withdrawalReceiptObserverForRpc(config.rpcUrl), signal));
    const report = await withWithdrawalCashOutStore(metadata.database, store =>
      recordObservedWithdrawalCashOut(journal, store, original.id, signal));
    const store = new SqliteAdapter(metadata.database, { readOnly: true });
    try {
      assert.deepEqual(await store.getCreatorWithdrawal(original.id, original.owner), original);
      assert.equal((await store.listPayments(10)).length, 0);
      const cashOuts = await store.listWithdrawals(10);
      if (report.state === "recorded") {
        assert.equal(cashOuts.length, 1);
        assert.equal(cashOuts[0].txHash, report.transactionHash);
        assert.equal(cashOuts[0].wallet, original.owner);
        assert.equal(cashOuts[0].recipient, original.owner);
        assert.equal(cashOuts[0].amountUsdc, Number(original.request.burnIntent.spec.value) / 1e6);
        assert.equal(cashOuts[0].network, "eip155:5042002");
      } else assert.equal(cashOuts.length, 0);
      assert.equal(journal.gasAdmissionSummary().committedRequests, 1);
      console.log(JSON.stringify({ state: "keyless-original-recovery", requestId: original.id,
        transactionHash: (await journal.getPrepared(original.id))?.transactionHash,
        progress: await withdrawalTransferProgress(store, original.id, original.owner), result, report,
        cashOutRows: cashOuts.length, gasAdmission: journal.gasAdmissionSummary(),
        paymentRows: 0, transferPosts: 0, signatures: 0, broadcasts: 0 }));
    } finally { store.close(); }
  } finally { database.close(); }
}
main().catch(() => { console.error("Withdrawal rehearsal unavailable; retain original files and journal. Private details omitted."); process.exitCode = 1; });
