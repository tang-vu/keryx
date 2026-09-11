import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({ options: { help: { type: "boolean" }, run: { type: "boolean" },
    upgrade: { type: "boolean" }, queue: { type: "boolean" }, cycle: { type: "boolean" }, "application-db": { type: "string" },
    gas: { type: "string" }, "max-fee-per-gas": { type: "string" }, "priority-fee-per-gas": { type: "string" },
    "gas-budget-wei": { type: "string" }, "after-id": { type: "string" }, limit: { type: "string" } }, strict: true });
  if (values.help) {
    console.log(`Usage: node --import tsx scripts/withdrawal-relay.mts [--run | --upgrade | --queue | --cycle]
Default: inspect an existing protected Linux relay journal without RPC/signing.
--run: one bounded testnet relay pass using the dedicated configured key.
--upgrade: explicitly upgrade the original journal schema; does not relay.
--queue: attach stored attestations to admitted requests; no RPC/signing/broadcast.
--cycle: bounded queue sweep, one relay pass, then cash-out reporting. Uses the same
  required database/gas arguments as --queue; no cursor/limit arguments. May sign and
  broadcast original testnet mints, never submit another Circle transfer. A later
  operator invocation revisits pending originals. Private scan counts are not revenue.
  Requires --application-db ABSOLUTE_PATH --gas INTEGER --max-fee-per-gas WEI
  --priority-fee-per-gas WEI --gas-budget-wei WEI; optional --after-id DIGEST --limit 1..64.
  Continue private nextCursor pages; reset the cursor for each later full sweep.
Load operator environment files explicitly. Disabled unless KERYX_WITHDRAWAL_RELAY_ENABLED=1.
This command never creates a wallet/journal, renews an authorization or clears a lock.`);
    return;
  }
  if ([values.run, values.upgrade, values.queue, values.cycle].filter(Boolean).length > 1) throw new Error();
  if (values.cycle && (values["after-id"] !== undefined || values.limit !== undefined)) throw new Error();
  if (!values.queue && !values.cycle && [values["application-db"], values.gas, values["max-fee-per-gas"], values["priority-fee-per-gas"],
    values["gas-budget-wei"], values["after-id"], values.limit].some(value => value !== undefined)) throw new Error();
  const { config } = await import("../lib/config");
  const { withdrawalRelayRuntime } = await import("../lib/gateway/withdrawal-relay-runtime");
  const runtime = withdrawalRelayRuntime(process.env, config.networkId);
  if (!runtime) { console.log(JSON.stringify({ status: "disabled" })); return; }
  const { inspectWithdrawalRelayFiles } = await import("../lib/gateway/withdrawal-relay-files");
  const files = await inspectWithdrawalRelayFiles(runtime.directory);
  const { createWithdrawalMintJournal } = await import("../lib/gateway/withdrawal-mint-journal");
  const { DatabaseSync } = await import("node:sqlite");
  const { withPrivateWorkerLock } = await import("../lib/a2a/private-worker-lock");
  const policy = files.policy as Parameters<typeof createWithdrawalMintJournal>[1];
  if (policy.relayer?.toLowerCase() !== runtime.signer.address.toLowerCase()) throw new Error();
  const db = new DatabaseSync(files.databasePath, { readOnly: !values.run && !values.upgrade && !values.queue && !values.cycle });
  const stop = new AbortController(), shutdown = () => stop.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try {
    const rechecked = await inspectWithdrawalRelayFiles(runtime.directory);
    if (JSON.stringify(rechecked.databaseIdentity) !== JSON.stringify(files.databaseIdentity)
      || JSON.stringify(rechecked.policy) !== JSON.stringify(files.policy)) throw new Error();
    if (values.upgrade) {
      await withPrivateWorkerLock(files.directory, async () => {
        createWithdrawalMintJournal(db, policy, { upgrade: true });
      });
      console.log(JSON.stringify({ status: "schema-checked", network: config.networkId }));
      return;
    }
    const journal = createWithdrawalMintJournal(db, policy);
    if (values.queue || values.cycle) {
      const { withdrawalMintTermsSchema } = await import("../lib/gateway/withdrawal-mint-transaction");
      const terms = withdrawalMintTermsSchema.parse({ relayer: runtime.signer.address, nonce: 0, gas: values.gas,
        maxFeePerGas: values["max-fee-per-gas"], maxPriorityFeePerGas: values["priority-fee-per-gas"], gasBudgetWei: values["gas-budget-wei"] });
      const limit = values.limit === undefined ? 32 : /^[1-9][0-9]?$/.test(values.limit) ? Number(values.limit) : NaN;
      if (!values["application-db"] || !Number.isSafeInteger(limit) || limit > 64) throw new Error();
      const { withWithdrawalApplicationStore } = await import("../lib/gateway/withdrawal-application-store");
      const { queueWithdrawalRelayPage } = await import("../lib/gateway/withdrawal-relay-queue");
      if (values.cycle) {
        const { runWithdrawalCyclePass } = await import("../lib/gateway/withdrawal-cycle");
        const { runWithdrawalRelayWorker, withdrawalRelayDependenciesForRpc } = await import("../lib/gateway/withdrawal-relay-worker");
        const { withWithdrawalCashOutStore } = await import("../lib/gateway/withdrawal-application-store");
        const { reportWithdrawalCashOutPage } = await import("../lib/gateway/withdrawal-cash-out-page");
        const applicationDb = values["application-db"];
        const result = await runWithdrawalCyclePass({
          queue: (afterId, signal) => withWithdrawalApplicationStore(applicationDb, store =>
            queueWithdrawalRelayPage(files.directory, journal, store, terms, signal, { afterId, limit: 32 })),
          relay: signal => runWithdrawalRelayWorker(files.directory, journal, runtime.signer, runtime.otherSigners,
            withdrawalRelayDependenciesForRpc(config.rpcUrl, signal), signal),
          report: (afterId, signal) => withWithdrawalCashOutStore(applicationDb, store =>
            reportWithdrawalCashOutPage(journal, store, signal, { afterId, limit: 32 })),
        }, stop.signal);
        console.log(JSON.stringify(result));
        if (result.state === "aborted" || result.queue.state !== "scanned" || result.queue.unavailable || result.queue.pending
          || !result.relay || !["idle", "limited"].includes(result.relay.state) || result.report?.state !== "scanned"
          || result.report.unavailable || result.report.pending) process.exitCode = 2;
        return;
      }
      const result = await withWithdrawalApplicationStore(values["application-db"], store =>
        queueWithdrawalRelayPage(files.directory, journal, store, terms, stop.signal, { afterId: values["after-id"], limit }));
      console.log(JSON.stringify(result));
      if (result.state === "aborted" || result.unavailable > 0) process.exitCode = 2;
    } else if (values.run) {
      const { runWithdrawalRelayWorker, withdrawalRelayDependenciesForRpc } = await import("../lib/gateway/withdrawal-relay-worker");
      const result = await runWithdrawalRelayWorker(files.directory, journal, runtime.signer, runtime.otherSigners,
        withdrawalRelayDependenciesForRpc(config.rpcUrl, stop.signal), stop.signal);
      console.log(JSON.stringify(result));
      if (result.state !== "idle" && result.state !== "limited") process.exitCode = 2;
    } else {
      const summary = await withPrivateWorkerLock(files.directory, async () => {
        const ids = journal.listRequestIds(); let prepared = 0, observed = 0;
        for (const id of ids) {
          if (stop.signal.aborted) throw new Error();
          if (!await journal.getSlot(id)) throw new Error();
          if (await journal.getPrepared(id)) prepared++;
          if (await journal.getObserved(id)) observed++;
        }
        return { status: "inspected", network: config.networkId, slots: ids.length, prepared, observed,
          gasAdmission: journal.gasAdmissionSummary() };
      });
      console.log(JSON.stringify(summary));
    }
  } finally {
    db.close(); process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown);
  }
}
main().catch(() => { console.error("Withdrawal relay unavailable. Verify operator configuration, protected journal and existing lock; private details omitted."); process.exitCode = 1; });
