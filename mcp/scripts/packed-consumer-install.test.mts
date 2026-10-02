import { afterEach, expect, it } from "vitest";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPackedConsumer } from "./packed-consumer-install.mjs";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(exit: number | "wait") {
  const directory = mkdtempSync(join(tmpdir(), "keryx-install-summary-")); directories.push(directory);
  const cli = join(directory, "synthetic-cli.cjs");
  writeFileSync(cli, `
process.stdout.write('https://synthetic-auth-token@example.invalid/private-path\\n');
process.stderr.write('npm timing idealTree:init Completed in 17ms\\n');
process.stderr.write('npm timing idealTree:secret-token Completed in 1ms\\n');
process.stderr.write('npm timing reify:/private-path Completed in 1ms\\n');
process.stderr.write('npm timing reify:unpack Completed in 999999999ms\\n');
process.stderr.write('\\u001b[32mnpm timing reify:unpack Completed in 23ms\\u001b[0m\\n');
process.stderr.write('npm error token=synthetic-auth-token path=/private-path\\n');
${exit === "wait" ? "setTimeout(() => {}, 10000);" : `process.exitCode = ${exit};`}
`);
  const reports: string[] = [];
  return { directory, cli, reports, options: { report: (line: string) => reports.push(line) } };
}
function assertRedaction(reports: string[]) {
  expect(reports).toHaveLength(1);
  expect(reports[0]).not.toMatch(/synthetic-auth-token|private-path|example\.invalid|https?:|synthetic-cli/);
  const report = JSON.parse(reports[0]);
  expect(report).toMatchObject({ stage: "clean-consumer-install", deadlineMs: process.platform === "win32" ? 300000 : 120000, preferOffline: true,
    lastCompletedPhase: "reify:unpack", completedPhases: { "idealTree:init": 17, "reify:unpack": 23 } });
  expect(report.stdoutBytes).toBeGreaterThan(0); expect(report.stderrBytes).toBeGreaterThan(0);
  expect(report.elapsedMs).toBeGreaterThanOrEqual(0);
  return report;
}

it("reports fixed npm timing phases from a real successful child without forwarding either log stream", () => {
  const f = fixture(0);
  installPackedConsumer(f.cli, "synthetic.tgz", f.directory, f.options);
  expect(assertRedaction(f.reports)).toMatchObject({ category: "success", status: 0, signal: null });
});
it("classifies a real nonzero install exit and throws only a fixed sanitized message", () => {
  const f = fixture(23);
  expect(() => installPackedConsumer(f.cli, "synthetic.tgz", f.directory, f.options))
    .toThrow(/^Clean consumer dependency install failed \(exit\); sanitized timing summary above$/);
  expect(assertRedaction(f.reports)).toMatchObject({ category: "exit", status: 23, signal: null });
});
it("classifies an actual child timeout while the production invocation retains its platform deadline and one attempt", () => {
  const f = fixture("wait"); let calls = 0;
  const execute = (command: string, args: string[], options: SpawnSyncOptions) => {
    calls++;
    expect(command).toBe(process.execPath);
    expect(args).toEqual([f.cli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline", "--timing", "synthetic.tgz"]);
    expect(options).toMatchObject({ cwd: f.directory, stdio: "pipe", timeout: process.platform === "win32" ? 300000 : 120000 });
    // Only this synthetic test adapter reduces its sleep deadline; the helper has no deadline override.
    return spawnSync(command, args, { ...options, timeout: 3000 });
  };
  expect(() => installPackedConsumer(f.cli, "synthetic.tgz", f.directory, { ...f.options, execute }))
    .toThrow(/^Clean consumer dependency install failed \(timeout\); sanitized timing summary above$/);
  expect(assertRedaction(f.reports)).toMatchObject({ category: "timeout", status: null, signal: "SIGTERM" });
  expect(calls).toBe(1);
});
it("reports missing CLI as a sanitized nonzero child exit without paths or raw errors", () => {
  const f = fixture(0);
  expect(() => installPackedConsumer(join(f.directory, "private-path-missing.cjs"), "synthetic.tgz", f.directory, f.options))
    .toThrow(/^Clean consumer dependency install failed \(exit\); sanitized timing summary above$/);
  expect(f.reports[0]).not.toMatch(/private-path|MODULE_NOT_FOUND|Cannot find module/);
  expect(JSON.parse(f.reports[0])).toMatchObject({ category: "exit", status: 1, lastCompletedPhase: null, completedPhases: {} });
});
