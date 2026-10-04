#!/usr/bin/env node
/** One bounded, credential-free command for R19–R24 synthetic acceptance. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ARTIFACT_ROOT, commerceDirectory, commerceEnvironment, recoverCommerceOriginal } from "../lib/evals/commerce-workload.ts";

if (process.argv.includes("--recover-original")) {
  if (process.env.KERYX_FORCE_OFFLINE !== "1" || process.env.KERYX_NETWORK !== "arcTestnet") throw new Error("Synthetic recovery environment required");
  await recoverCommerceOriginal();
} else {
  if (process.argv.slice(2).some(arg => arg !== "--json")) throw new Error("Usage: node --import tsx scripts/eval-commerce-workload.mts [--json]");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (root !== process.cwd()) throw new Error("Run from the repository root");
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const directory = fs.mkdtempSync(path.join(ARTIFACT_ROOT, "run-"));
  process.env.KERYX_COMMERCE_ARTIFACT_DIR = directory;
  commerceDirectory();
  const testReport = path.join(directory, "vitest.json");
  const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "lib/evals/commerce-workload.test.ts",
    "--reporter=json", `--outputFile=${testReport}`], { cwd: root, env: commerceEnvironment(directory), encoding: "utf8",
    timeout: 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  fs.writeFileSync(path.join(directory, "runner.log"), (run.stdout ?? "") + (run.stderr ?? "") + (run.error?.message ?? ""));
  const report = fs.existsSync(testReport) ? JSON.parse(fs.readFileSync(testReport, "utf8")) : null;
  const tests: { fullName: string; status: string; failureMessages: string[] }[] = report?.testResults?.flatMap((result: { assertionResults: unknown[] }) => result.assertionResults) ?? [];
  const cases = Array.from({ length: 6 }, (_, index) => {
    const id = `R${index + 19}`;
    const test = tests.find(test => test.fullName.startsWith(id));
    const evidence = path.join(directory, `${id}.json`);
    return { id, invariantStatus: test?.status ?? "not-executed", taskAcceptance: "partial-synthetic-only",
      evidence: fs.existsSync(evidence) ? path.relative(root, evidence).replaceAll("\\", "/") : null,
      failures: (test?.failureMessages ?? []).map(message => message.slice(0, 3000)) };
  });
  const summary = { schemaVersion: "keryx-commerce-workload-execution-v1", executedAt: new Date().toISOString(),
    mode: "isolated-synthetic", mainnetPayments: 0, testnetPayments: 0, independentCustomerTasks: 0,
    externalProviderCalls: 0, cases, unexecutedGates: ["publisher-owned staging feed and testnet custody", "live network authority and settlement",
      "packaged desktop, extension and stdio installation", "authenticated production original recovery", "independent user usefulness and willingness to pay"],
    artifacts: path.relative(root, directory).replaceAll("\\", "/"), passed: run.status === 0 && cases.every(item => item.invariantStatus === "passed") };
  fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.passed) process.exitCode = 1;
}
