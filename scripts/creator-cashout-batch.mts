/** Explicit owner-operated testnet cohorts. No scheduler, implicit env load or legacy relay. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, encodeFunctionData } from "viem";
import { config } from "../lib/config.ts";
import { getGatewayAvailableAtomic } from "../lib/gateway/gateway-balance.ts";
import { validateWithdrawalRequest } from "../lib/gateway/withdrawal-request.ts";
import { estimateWithdrawalIntent } from "../lib/gateway/withdrawal-estimate.ts";
import { withdrawalHeightWindowForRpc } from "../lib/gateway/withdrawal-height-window.ts";
import { inspectWithdrawalRelayDirectory, inspectWithdrawalRelayFiles } from "../lib/gateway/withdrawal-relay-files.ts";
import { createWithdrawalMintJournal, validateWithdrawalMintJournalPolicy } from "../lib/gateway/withdrawal-mint-journal.ts";
import { createWithdrawalRuntimeAdmission } from "../lib/gateway/withdrawal-admission-bootstrap.ts";
import { submitWithdrawalTransfer, requestCircleWithdrawalTransfer, withdrawalTransferProgress } from "../lib/gateway/withdrawal-transfer-service.ts";
import { withdrawalRelayRuntime } from "../lib/gateway/withdrawal-relay-runtime.ts";
import { runWithdrawalRelayWorker, withdrawalRelayDependenciesForRpc } from "../lib/gateway/withdrawal-relay-worker.ts";
import { withdrawalReceiptObserverForRpc } from "../lib/gateway/withdrawal-receipt-observation.ts";
import { WITHDRAWAL_MINTER_ABI } from "../lib/gateway/withdrawal-mint-observation.ts";
import { withdrawalRpcTransport } from "../lib/gateway/withdrawal-rpc-transport.ts";
import { withWithdrawalApplicationStore, withWithdrawalCashOutStore } from "../lib/gateway/withdrawal-application-store.ts";
import { recordObservedWithdrawalCashOut } from "../lib/gateway/withdrawal-cash-out.ts";
import { withPrivateWorkerLock } from "../lib/a2a/private-worker-lock.ts";
import { withNewWithdrawalDrillStore } from "./creator-withdrawal-drill-store.ts";
import { saveWithdrawalDrillExclusive as saveExclusive } from "./withdrawal-drill-files.ts";
import { prepareCreatorBatchPlan, validateCreatorBatchPlan, creatorBatchPlanDigest } from "./creator-cashout-batch-plan.ts";
import { readCreatorBatchJson } from "./creator-cashout-batch-files.ts";
import { withCreatorBatchStore } from "./creator-cashout-batch-store.ts";
import { retainedCreatorBatchOriginal } from "./creator-cashout-batch-signing.ts";
import { creatorBatchBroadcastOnce, queueCreatorBatchMints } from "./creator-cashout-batch-mint.ts";

const { values } = parseArgs({ options: {
  help: { type: "boolean" }, prepare: { type: "boolean" }, import: { type: "boolean" },
  submit: { type: "boolean" }, mint: { type: "boolean" }, recover: { type: "boolean" },
  directory: { type: "string" }, manifest: { type: "string" }, original: { type: "string" }, "plan-sha256": { type: "string" },
  owner: { type: "string" }, "relay-directory": { type: "string" }, "public-db": { type: "string" },
  "max-ahead-blocks": { type: "string" }, "max-processing-lag-blocks": { type: "string" },
  "confirm-isolated-custody": { type: "boolean" },
}, strict: true });
const signal = AbortSignal.timeout(180000), gasCeiling = "9000000000000000";
const gas = "300000", maxFeePerGas = "30000000000", maxPriorityFeePerGas = "5000000000";
const contracts = { domain: 26, gatewayWallet: config.gatewayWallet, gatewayMinter: config.gatewayMinter, asset: config.usdcAddress };
function bounds() {
  assert.ok(values["max-ahead-blocks"] && values["max-processing-lag-blocks"]);
  return { maxAheadBlocks: values["max-ahead-blocks"], maxProcessingLagBlocks: values["max-processing-lag-blocks"] };
}
async function freshTerms(original: Awaited<ReturnType<typeof validateWithdrawalRequest>>) {
  const height = await withdrawalHeightWindowForRpc(config.rpcUrl, original.policy, bounds(), signal);
  assert.ok(BigInt(original.request.burnIntent.maxBlockHeight) >= BigInt(height.minimumBlockHeight)
    && BigInt(original.request.burnIntent.maxBlockHeight) <= BigInt(height.maximumBlockHeight));
}
async function main() {
  if (values.help) {
    console.log("Creator cash-out batch: --prepare --manifest PUBLIC_JSON --directory NEW_PRIVATE_DIR; --import --original RETAINED_SIGNED_JSON; --submit --relay-directory EXISTING_FRESH_JOURNAL --confirm-isolated-custody; --mint --confirm-isolated-custody; --recover [--public-db EXISTING_DB]. All existing-plan modes require --plan-sha256 REVIEWED_DIGEST. Owner signatures use creator-cashout-batch-sign.mts on the original custody host. Prepare/submit need explicit height limits. Up to 23 owners / 55 test USDC, fee cap 3900 micro-USDC each. Linux execution only; no implicit env files, timer, HTTP activation, unknown-state retry or new funding. Existing originals and markers always win.");
    return;
  }
  assert.equal([values.prepare, values.import, values.submit, values.mint, values.recover].filter(Boolean).length, 1);
  assert.equal(process.platform, "linux"); process.umask(0o077);
  assert.equal(config.networkId, "eip155:5042002"); assert.equal(config.cctpDomain, 26);
  assert.ok(!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY);
  assert.ok(values.directory && path.isAbsolute(values.directory) && path.resolve(values.directory) === values.directory);
  const directory = values.directory, planFile = path.join(directory, "plan.json"), application = path.join(directory, "application");
  const database = path.join(application, "keryx.sqlite");
  if (values.prepare) {
    assert.ok(values.manifest && !values.original && !values.owner && !values["public-db"]);
    await inspectWithdrawalRelayDirectory(path.dirname(directory));
    assert.ok(!fs.existsSync(directory));
    const manifest = await readCreatorBatchJson(path.resolve(values.manifest));
    const plan = await prepareCreatorBatchPlan(manifest, contracts, { balance: getGatewayAvailableAtomic,
      height: policy => withdrawalHeightWindowForRpc(config.rpcUrl, policy, bounds(), signal),
      estimate: (candidate, policy, height) => estimateWithdrawalIntent(candidate, policy, height, signal) });
    signal.throwIfAborted(); fs.mkdirSync(directory, { mode: 0o700 });
    saveExclusive(planFile, plan); fs.mkdirSync(application, { mode: 0o700 });
    await withNewWithdrawalDrillStore(database, async () => {});
    console.log(JSON.stringify({ state: "unsigned-batch-retained", planSha256: creatorBatchPlanDigest(plan), owners: plan.manifest.owners,
      requests: plan.drafts.map(draft => ({ owner: draft.owner, requestId: draft.id, amountMicros: draft.burnIntent.spec.value, maxFeeMicros: draft.burnIntent.maxFee })),
      maxTotalDebitMicros: plan.manifest.maxTotalDebitMicros, signatures: 0, circleTransferPosts: 0, broadcasts: 0 }));
    return;
  }
  await inspectWithdrawalRelayDirectory(directory);
  const plan = validateCreatorBatchPlan(await readCreatorBatchJson(planFile));
  assert.ok(values["plan-sha256"] && /^[a-f0-9]{64}$/.test(values["plan-sha256"]));
  assert.equal(creatorBatchPlanDigest(plan), values["plan-sha256"]);
  for (const draft of plan.drafts) for (const field of ["domain", "gatewayWallet", "gatewayMinter", "asset"] as const)
    assert.equal(String(draft.policy[field]).toLowerCase(), String(contracts[field]).toLowerCase());
  const selected = plan.drafts.filter(draft => !values.owner || draft.owner === values.owner.toLowerCase());
  assert.ok(selected.length);
  const originalPath = (id: string) => path.join(directory, `original-${id}.json`);
  const retainedOriginal = (draft: typeof plan.drafts[number]) => retainedCreatorBatchOriginal(directory, draft);
  if (values.import) {
    assert.ok(values.original && values.owner && !values["public-db"] && !values["relay-directory"]);
    const original = await validateWithdrawalRequest(await readCreatorBatchJson(path.resolve(values.original)));
    const draft = selected.find(row => row.id === original.id); assert.ok(draft);
    assert.deepEqual(original.policy, draft.policy); assert.deepEqual(original.request.burnIntent, draft.burnIntent);
    await withPrivateWorkerLock(directory, async () => {
      if (fs.existsSync(originalPath(draft.id))) assert.deepEqual(await retainedOriginal(draft), original);
      else saveExclusive(originalPath(draft.id), original);
      assert.deepEqual(await retainedOriginal(draft), original);
    });
    console.log(JSON.stringify({ state: "original-imported-recovery-bound", requestId: original.id, signatures: 0, circleTransferPosts: 0, broadcasts: 0 })); return;
  }
  const bindingPath = path.join(directory, "relay-binding.json");
  if (values.submit) {
    assert.ok(values["relay-directory"] && values["confirm-isolated-custody"] && !values.original && !values["public-db"] && process.env.KERYX_FORCE_OFFLINE !== "1");
    const env = { ...process.env, KERYX_WITHDRAWAL_RELAY_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ISOLATED: "1",
      KERYX_WITHDRAWAL_RELAY_DIRECTORY: values["relay-directory"] };
    const relay = withdrawalRelayRuntime(env, config.networkId); assert.ok(relay);
    const files = await inspectWithdrawalRelayFiles(relay.directory), policy = validateWithdrawalMintJournalPolicy(files.policy);
    assert.equal(policy.relayer, relay.signer.address.toLowerCase()); assert.equal(policy.initialNonce, 0);
    assert.equal(policy.maxSlots, plan.drafts.length); assert.equal(policy.lifetimeGasBudgetWei, (BigInt(gasCeiling) * BigInt(plan.drafts.length)).toString());
    const binding = { relayDirectory: files.directory, policy };
    const results = await withPrivateWorkerLock(directory, async () => {
      if (fs.existsSync(bindingPath)) assert.deepEqual(await readCreatorBatchJson(bindingPath), binding);
      else {
        const journalDb = new DatabaseSync(files.databasePath, { readOnly: true });
        try { const journal = createWithdrawalMintJournal(journalDb, policy);
          assert.equal(journal.gasAdmissionSummary().committedRequests, 0); assert.deepEqual(journal.listRequestIds(), []);
        } finally { journalDb.close(); }
        saveExclusive(bindingPath, binding);
      }
      return withCreatorBatchStore(database, async store => {
        const result = [];
        const admit = createWithdrawalRuntimeAdmission(env, config.networkId, config.rpcUrl, gasCeiling);
        for (const draft of selected) {
          try {
            const original = await retainedOriginal(draft);
            const progress = await submitWithdrawalTransfer(store, original, original.owner, async (record, current) => {
              await freshTerms(record);
              const available = await getGatewayAvailableAtomic(record.owner);
              assert.ok(available !== null && available >= BigInt(record.request.burnIntent.spec.value) + BigInt(record.request.burnIntent.maxFee));
              await admit(record, current);
            }, async (record, current) => { await freshTerms(record); return requestCircleWithdrawalTransfer(record, current); }, signal);
            result.push({ owner: draft.owner, progress });
          } catch { result.push({ owner: draft.owner, state: "unavailable-original-retained" }); }
        }
        return result;
      });
    });
    console.log(JSON.stringify({ results })); process.exitCode = results.some(row => !("progress" in row) || row.progress?.status !== "attestation-stored") ? 2 : 0; return;
  }
  assert.ok(!values.original);
  const binding = await readCreatorBatchJson(bindingPath) as { relayDirectory: string; policy: unknown };
  const files = await inspectWithdrawalRelayFiles(binding.relayDirectory), policy = validateWithdrawalMintJournalPolicy(files.policy);
  assert.deepEqual(policy, binding.policy);
  assert.equal(policy.maxSlots, plan.drafts.length); assert.equal(policy.lifetimeGasBudgetWei, (BigInt(gasCeiling) * BigInt(plan.drafts.length)).toString());
  const journalDb = new DatabaseSync(files.databasePath);
  try {
    const journal = createWithdrawalMintJournal(journalDb, policy);
    const knownIds = new Set<string>(plan.drafts.map(draft => draft.id));
    for (const id of [...journal.listRequestIds(), ...journal.listGasAdmissionIds(undefined, 64).ids]) assert.ok(knownIds.has(id));
    if (values.mint) {
      assert.ok(!values.owner && !values["public-db"] && values["confirm-isolated-custody"] && process.env.KERYX_FORCE_OFFLINE !== "1");
      const env = { ...process.env, KERYX_WITHDRAWAL_RELAY_ENABLED: "1", KERYX_WITHDRAWAL_RELAY_ISOLATED: "1",
        KERYX_WITHDRAWAL_RELAY_DIRECTORY: files.directory };
      const relay = withdrawalRelayRuntime(env, config.networkId); assert.ok(relay); assert.equal(policy.relayer, relay.signer.address.toLowerCase());
      // Estimate every newly attachable attestation before fixing bounded nonce/gas
      // terms. Already queued slots retain their original terms.
      const client = createPublicClient({ transport: withdrawalRpcTransport(config.rpcUrl, signal) });
      const queue = await withWithdrawalApplicationStore(database, store =>
        queueCreatorBatchMints(files.directory, journal, store, { relayer: policy.relayer, gas, maxFeePerGas,
          maxPriorityFeePerGas, gasBudgetWei: gasCeiling }, (held, response) => client.estimateGas({ account: relay.signer.address, to: held.request.policy.gatewayMinter,
            value: BigInt("0"), maxFeePerGas: BigInt(maxFeePerGas), maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas),
            data: encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint", args: [response.attestation, response.signature] })
        }), signal));
      const dependencies = withdrawalRelayDependenciesForRpc(config.rpcUrl, signal), send = dependencies.client.sendRawTransaction.bind(dependencies.client);
      dependencies.client.sendRawTransaction = creatorBatchBroadcastOnce(directory, journal, plan, send, signal);
      const result = await runWithdrawalRelayWorker(files.directory, journal, relay.signer, relay.otherSigners, dependencies, signal, Math.min(plan.drafts.length, 16));
      console.log(JSON.stringify({ queue, result, gasAdmission: journal.gasAdmissionSummary() }));
      process.exitCode = result.state === "idle" && queue.unavailable === 0 && queue.awaitingEvidence === 0 && queue.estimateUnavailableIds.length === 0 ? 0 : 2; return;
    }
    // Only explicit --recover can observe/report. No runtime signer or /transfer.
    assert.ok(values.recover && !values["relay-directory"] && !values["confirm-isolated-custody"]);
    const results = await withPrivateWorkerLock(directory, async () => {
      const results = [];
      for (const draft of selected) {
        try {
          await retainedOriginal(draft);
          const checked = await withPrivateWorkerLock(files.directory, () => journal.reconcile(draft.id, withdrawalReceiptObserverForRpc(config.rpcUrl), signal));
          const row = plan.manifest.owners.find(owner => owner.owner === draft.owner)!;
          const report = await withCreatorBatchStore(database, privateStore =>
            withWithdrawalCashOutStore(values["public-db"] ? path.resolve(values["public-db"]) : database, cashOutStore =>
              recordObservedWithdrawalCashOut(journal, { getCreatorWithdrawal: privateStore.getCreatorWithdrawal.bind(privateStore),
                recordWithdrawal: record => cashOutStore.recordWithdrawal({ ...record, label: row.label, sourceName: row.sourceName }) }, draft.id, signal)), true);
          const progress = await withCreatorBatchStore(database, store => withdrawalTransferProgress(store, draft.id, draft.owner), true);
          const residual = await getGatewayAvailableAtomic(draft.owner);
          results.push({ owner: draft.owner, requestId: draft.id, latestCheck: checked.latestCheck, report, progress,
            residualAvailableMicros: residual?.toString() ?? null });
        } catch { results.push({ owner: draft.owner, requestId: draft.id, state: "unavailable-original-retained" }); }
      }
      return results;
    });
    console.log(JSON.stringify({ results, gasAdmission: journal.gasAdmissionSummary(), signatures: 0, broadcasts: 0, circleTransferPosts: 0 }));
    process.exitCode = results.some(row => !("report" in row) || row.report?.state !== "recorded") ? 2 : 0;
  } finally { journalDb.close(); }
}
main().catch(() => { console.error("Creator cash-out cohort unavailable; retain original plan, markers and journals. Private details omitted."); process.exitCode = 1; });
