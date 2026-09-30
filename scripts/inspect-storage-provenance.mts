import { inspectStorageProvenance } from "../lib/db/storage-provenance.ts";

if (process.argv.length !== 3) {
  console.error("Usage: node --import tsx scripts/inspect-storage-provenance.mts <absolute-existing-sqlite-file>");
  process.exitCode = 2;
} else {
  const report = await inspectStorageProvenance(process.argv[2]);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "intake_only" ? 0 : 1;
}
