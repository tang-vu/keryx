import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
assert.equal(process.platform, "linux");
const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const script = resolve("scripts/economics-private-report.mts"), root = mkdtempSync("/tmp/keryx-private-report-cli-");
chmodSync(root, 0o700); mkdirSync(join(root, "data"), { mode: 0o700 });
const database = join(root, "data/keryx.sqlite"), db = new DatabaseSync(database);
db.exec("CREATE TABLE query_runs(economics_data TEXT); CREATE TABLE payment_events(query_id TEXT,kind TEXT,amount_usdc REAL,settled INTEGER,settlement_status TEXT,grant_epoch TEXT); CREATE TABLE a2a_orders(query_id TEXT,creator_budget_usdc REAL,service_fee_usdc REAL,status TEXT,response_data TEXT);"); db.close();
const before = readFileSync(database), guard = join(root, "no-network.mjs");
writeFileSync(guard, "globalThis.fetch=async()=>{throw new Error('Network forbidden in private report fixture')};", { mode: 0o600 });
async function run() {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", "--import", pathToFileURL(guard).href, "--import", loader, script,
      "--directory", join(root, "report")], { cwd: root, env: { PATH: process.env.PATH, ESBUILD_BINARY_PATH: process.env.ESBUILD_BINARY_PATH, NODE_ENV: "test", KERYX_FORCE_OFFLINE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
const first = await run(); assert.equal(first.code, 0, first.stderr);
assert.equal(first.stdout.trim(), "Private economics report saved. No invoice reconciliation or realized profit asserted.");
const file = join(root, "report/economics.json"), content = readFileSync(file);
assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(join(root, "report")).mode & 0o777, 0o700);
assert.equal(JSON.parse(content.toString()).accounting.realizedProfitUsd, null);
assert.deepEqual(readFileSync(database), before, "Report must not initialize or mutate the application database");
const repeated = await run(); assert.equal(repeated.code, 1); assert.equal(repeated.stdout, "");
assert.deepEqual(readFileSync(file), content);
console.log("PASS: native Linux operator CLI, private output, empty synthetic telemetry, unchanged database, no network, and overwrite refusal.");
