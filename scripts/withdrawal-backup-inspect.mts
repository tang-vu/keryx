import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({ strict: true, options: { help: { type: "boolean" },
    directory: { type: "string" }, "manifest-sha256": { type: "string" } } });
  if (values.help) {
    console.log(`Usage: node --import tsx scripts/withdrawal-backup-inspect.mts
  --directory PRIVATE_BACKUP_DIRECTORY --manifest-sha256 TRUSTED_RETAINED_DIGEST
Linux/Node 24, local inspection only. Obtain the digest from the separately retained
successful backup output, not by hashing an untrusted copy. Verifies manifest, policy,
database bytes and original journal records. Does not restore, contact RPC or sign.
Even a matching copy cannot prove there were no later admissions or signatures.`); return;
  }
  if (!values.directory || !values["manifest-sha256"]) throw new Error();
  const stop = new AbortController(), shutdown = () => stop.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try {
    const { inspectWithdrawalBackup } = await import("../lib/gateway/withdrawal-backup-inspect");
    console.log(JSON.stringify(await inspectWithdrawalBackup(values.directory, values["manifest-sha256"], stop.signal)));
  } finally { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
}
main().catch(() => { console.error("Withdrawal backup inspection unavailable. Retain originals; do not resume signing."); process.exitCode = 1; });
