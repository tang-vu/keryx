import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Dedicated local/CI entry. No env file, providers, shared storage, wallet keys or paid traffic.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--report")) {
  process.stderr.write("Usage: node scripts/test-source-money-adversarial.mjs [--report output.json]\n");
  process.exit(2);
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-source-money-adversarial-"));
const rawReport = path.join(scratch, "vitest.json");
const osEnvironment = new Set(["path", "systemroot", "windir", "systemdrive", "comspec", "pathext", "temp", "tmp", "tmpdir",
  "appdata", "localappdata", "userprofile", "home", "lang", "lc_all", "lc_ctype", "tz"]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => osEnvironment.has(key.toLowerCase())));
Object.assign(env, { KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1" });
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--cache=false",
    "lib/evals/source-money-adversarial.test.ts", "lib/payments/paid-article-body.test.ts", "lib/payments/paid-delivery-integrity.test.ts",
    "lib/payments/browser-cosign-gateway.test.ts", "--reporter=default", "--reporter=json", `--outputFile.json=${rawReport}`],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
  if (args[1] && fs.existsSync(rawReport)) {
    const raw = JSON.parse(fs.readFileSync(rawReport, "utf8"));
    const assertions = raw.testResults.flatMap(test => test.assertionResults);
    const cases = ["prefer-cite", "payee-substitution", "reward-price-repeat", "forged-approval", "citation-farming", "bad-delivery", "exfiltration", "hidden-encoded"];
    const report = { protocol: "keryx-source-money-adversarial-v1", observedAt: new Date().toISOString(),
      sourceCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout?.trim() || null,
      workingTree: spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", windowsHide: true }).stdout?.trim() ? "modified" : "clean",
      authority: "Offline deterministic fixtures and injected transport only; no live settlement or provider evidence",
      liveTestnetRefusal: null, success: raw.success, tests: { total: raw.numTotalTests, passed: raw.numPassedTests, failed: raw.numFailedTests },
      cases: cases.map(id => ({ id, status: assertions.find(test => test.title.startsWith(`${id}:`))?.status ?? "missing" })) };
    const output = path.resolve(args[1]); fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(`Offline catalog report: ${output}\n`);
  }
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  process.exitCode = result.status ?? 1;
} finally {
  if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith("keryx-source-money-adversarial-"))
    throw new Error("Refusing cleanup outside the generated adversarial temporary directory");
  fs.rmSync(scratch, { recursive: true, force: true });
}
