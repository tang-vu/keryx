import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({ strict: true, options: { help: { type: "boolean" },
    source: { type: "string" }, destination: { type: "string" } } });
  if (values.help) {
    console.log(`Usage: node --import tsx scripts/withdrawal-backup.mts
  --source EXISTING_RELAY_DIRECTORY --destination NEW_PRIVATE_DIRECTORY
Linux with Node 24: copy and verify the existing journal under its cooperative lock.
Output and backup files are private and contain signed payment authorizations.
No key or RPC is used. Existing/partial targets and retained locks are never removed.
This snapshot does not authorize restoring an older nonce history or resuming signing.
Application records, custody inventory, off-host copies and restore reconciliation
remain separate operator requirements.`); return;
  }
  if (!values.source || !values.destination) throw new Error();
  const stop = new AbortController(), shutdown = () => stop.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try {
    const { backupWithdrawalJournal } = await import("../lib/gateway/withdrawal-backup");
    const result = await backupWithdrawalJournal(values.source, values.destination, stop.signal);
    console.log(JSON.stringify({ state: result.state, directory: result.directory,
      capturedAt: result.manifest.capturedAt, signingResumeAuthorized: false }));
  } finally { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
}
main().catch(() => {
  console.error("Withdrawal backup unavailable. Retain files and locks for inspection; do not resume signing from an uncertain copy.");
  process.exitCode = 1;
});
