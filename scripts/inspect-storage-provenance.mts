import { inspectStorageProvenance } from "../lib/db/storage-provenance.ts";

const args = process.argv.slice(2);
const offline = args.length === 2 && args[0] === "--offline-snapshot" && !args[1].startsWith("--");
if (!(offline || (args.length === 1 && !args[0].startsWith("--")))) {
  console.error("Usage: node --import tsx scripts/inspect-storage-provenance.mts [--offline-snapshot] <absolute-existing-sqlite-file>");
  process.exitCode = 2;
} else {
  const report = await inspectStorageProvenance(args[offline ? 1 : 0], {}, offline ? "offline_snapshot" : "standard");
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "intake_only" ? 0 : 1;
}
