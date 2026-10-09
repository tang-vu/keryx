import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adversarialEnvironment, buildAdversarialReport, captureProcess, readBoundedFile, snapshotSource,
  writeCaptureArtifacts } from "./source-money-adversarial-report.mjs";

// Dedicated local/CI entry. No env file, providers, shared storage, wallet keys or paid traffic.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--report")) {
  process.stderr.write("Usage: node scripts/test-source-money-adversarial.mjs [--report output.json]\n");
  process.exit(2);
}
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "keryx-source-money-adversarial-"));
const rawReport = path.join(scratch, "vitest.json");
const env = adversarialEnvironment(process.env);
process.stdout.write(`Retained adversarial capture directory: ${scratch}\n`);
try {
  const before = await snapshotSource(root, env, { directory: scratch, phase: "before" });
  const capture = await captureProcess(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--cache=false",
    "lib/evals/source-money-adversarial.test.ts", "lib/payments/paid-article-body.test.ts", "lib/payments/paid-delivery-integrity.test.ts",
    "lib/payments/browser-cosign-gateway.test.ts", "--reporter=default", "--reporter=json", `--outputFile.json=${rawReport}`],
  { cwd: root, env });
  await writeCaptureArtifacts(scratch, "vitest", capture);
  process.stdout.write(capture.stdout.raw); process.stderr.write(capture.stderr.raw);
  const after = await snapshotSource(root, env, { directory: scratch, phase: "after" });
  let reportBytes;
  try { reportBytes = await readBoundedFile(rawReport, 4 * 1024 * 1024); } catch { /* Recorded as a report refusal below. */ }
  const report = buildAdversarialReport({ capture, reportBytes, before, after });
  report.artifacts = { directory: scratch, retained: true };
  const bytes = JSON.stringify(report, null, 2) + "\n";
  await fs.writeFile(path.join(scratch, "report.json"), bytes, { flag: "wx" });
  if (args[1]) {
    const output = path.resolve(args[1]); await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, bytes, { flag: "wx" });
    process.stdout.write(`Offline catalog report: ${output}\n`);
  }
  if (!report.success) process.stderr.write(`Refused successful report: ${report.refusalReasons.join(", ")}\n`);
  process.exitCode = report.success ? 0 : 1;
} catch (error) {
  await fs.writeFile(path.join(scratch, "runner-error.json"), JSON.stringify({ name: error.name, code: error.code ?? null }, null, 2) + "\n", { flag: "wx" });
  process.stderr.write(`Runner failed; partial evidence retained at ${scratch}\n`);
  process.exitCode = 1;
}
