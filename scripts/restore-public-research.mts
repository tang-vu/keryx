/** Explicit operator tool. Never invoked by application startup or deployment. */
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../lib/canonical-json";
import { readRuntimeStorageDeployment } from "../lib/db/runtime-storage-config";
import { openVerifiedSqliteStorage } from "../lib/db/storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "../lib/db/enrolled-sqlite-schema-profile";
import { applyLegacyRestorePlan, exportLegacyResearch, inspectLegacyRestorePlan, makeLegacyRestorePlan,
  type LegacyResearchReview } from "../lib/db/public-research-restore";

const [command, ...args] = process.argv.slice(2);
const allowed: Record<string, readonly string[]> = {
  export: ["--out"], "dry-run": ["--review", "--decisions", "--out"],
  apply: ["--plan", "--expected-plan-sha256", "--out"],
};
if (!command || !allowed[command] || args.length !== allowed[command].length * 2)
  throw new Error("Use export --out, dry-run --review --decisions --out, or apply --plan --expected-plan-sha256 --out");
const values = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (!allowed[command].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error("Invalid operator arguments");
  values.set(args[i], args[i + 1]);
}
function readJson(key: string) {
  const file = resolve(values.get(key)!);
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("Protected review input exceeds the supported bound");
  const bytes = readFileSync(file);
  if (bytes.length > 64 * 1024 * 1024) throw new Error("Protected review input exceeds the supported bound");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Invalid protected review JSON"); }
}
const deployment = readRuntimeStorageDeployment(), pinned = canonicalJson(deployment);
if (deployment.identity.authorityMode !== "mainnet-real" || deployment.backend.kind !== "sqlite")
  throw new Error("The protected deployment must select the existing mainnet SQLite store");
const runtimeGuard = () => {
  if (canonicalJson(readRuntimeStorageDeployment()) !== pinned) throw new Error("Selected deployment changed");
};
// Reserve the new protected output before any production DML. Never overwrite evidence.
const output = resolve(values.get("--out")!);
const descriptor = openSync(output, "wx", 0o600);
let connection: ReturnType<typeof openVerifiedSqliteStorage> | undefined;
try {
  connection = openVerifiedSqliteStorage(deployment.backend.databasePath, deployment.identity, {
    readOnly: command !== "apply", runtimeGuard, applicationProfiles: supportedSqliteApplicationProfiles(true),
  });
  let result: unknown, summary: unknown;
  if (command === "export") {
    const review = exportLegacyResearch(connection.db, new Date().toISOString()); result = review;
    summary = { command, exportedCandidates: review.candidates.length, containsProtectedOriginals: true };
  } else if (command === "dry-run") {
    const plan = makeLegacyRestorePlan(readJson("--review") as LegacyResearchReview, readJson("--decisions"));
    const counts = inspectLegacyRestorePlan(connection.db, plan); result = plan;
    summary = { command, ...counts, dataMutation: false };
  } else {
    const receipt = applyLegacyRestorePlan(connection.db, readJson("--plan"), values.get("--expected-plan-sha256")!);
    result = receipt; summary = { command, approved: receipt.approved, excluded: receipt.excluded, published: receipt.published,
      stale: receipt.stale, blocked: receipt.blocked, originalsAndFinancialRecordsUnchanged: true };
  }
  const bytes = canonicalJson(result);
  writeFileSync(descriptor, bytes);
  console.log(JSON.stringify({ ...summary as object, output, sha256: createHash("sha256").update(bytes).digest("hex") }));
} finally { connection?.close(); closeSync(descriptor); }
