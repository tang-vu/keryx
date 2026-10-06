import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectOriginalFulfillmentStorage, migrateOriginalFulfillmentStorage } from "./mainnet-economic-storage-migrate.mjs";

/** This command touches storage metadata only, with an exclusive verified backup.
 * --writers-stopped records operator proof; it does not discover or stop processes. */
export async function runOriginalFulfillmentStorageCli(args: string[]) {
  if (args.length === 3 && args[0] === "inspect" && args[1] === "--manifest") return inspectOriginalFulfillmentStorage(args[2]);
  const names = ["--manifest", "--expected-manifest", "--expected-identity", "--backup", "--receipt"];
  if (args.length !== 12 || args[0] !== "migrate" || args[11] !== "--writers-stopped" || names.some((name, index) => args[index * 2 + 1] !== name))
    throw new Error("Original fulfillment storage arguments refused");
  return migrateOriginalFulfillmentStorage({ manifest: args[2], expectedManifestDigest: args[4], expectedIdentityDigest: args[6],
    backup: args[8], receipt: args[10], writersStopped: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runOriginalFulfillmentStorageCli(process.argv.slice(2)))); }
  catch { console.error("Original fulfillment migration refused or acknowledgement incomplete; keep writers stopped and preserve all evidence."); process.exitCode = 1; }
}
