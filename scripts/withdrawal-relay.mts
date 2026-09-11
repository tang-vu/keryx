import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({ options: { help: { type: "boolean" }, run: { type: "boolean" },
    upgrade: { type: "boolean" } }, strict: true });
  if (values.help) {
    console.log(`Usage: node --import tsx scripts/withdrawal-relay.mts [--run | --upgrade]
Default: inspect an existing protected Linux relay journal without RPC/signing.
--run: one bounded testnet relay pass using the dedicated configured key.
--upgrade: explicitly upgrade the original journal schema; does not relay.
Load operator environment files explicitly. Disabled unless KERYX_WITHDRAWAL_RELAY_ENABLED=1.
This command never creates a wallet/journal, renews an authorization or clears a lock.`);
    return;
  }
  if (values.run && values.upgrade) throw new Error();
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
  const db = new DatabaseSync(files.databasePath, { readOnly: !values.run && !values.upgrade });
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
    if (values.run) {
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
