import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { capturePublicUsageFixtureCommand as capture, publicUsageFixtureCommandDiagnostic as diagnostic,
  publicUsageFixtureCommandSucceeded as succeeded } from "../test-support/public-usage-fixture-command";
// Only OS inputs; no inherited database, Docker, provider, custody or application configuration.
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };
const node = (source: string, input?: string) => capture(process.execPath, ["-e", source], env, input);
it("captures a no-input fast exit with real zero/close and both EOFs without a stdin pipe", async () => {
  const result = await node("process.stdout.write('fast');process.exit(0)");
  expect(succeeded(result)).toBe(true); expect(result.stdout.toString()).toBe("fast");
  expect(result).toMatchObject({ inputMode: "none", errorCode: null, exitObserved: true, closeObserved: true, outEOF: true, errEOF: true });
});
it("keeps an explicit empty or nonempty stdin payload distinct and observes its full EOF", async () => {
  for (const input of ["", "synthetic SQL input only"]) {
    const result = await node("let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(data))", input);
    expect(succeeded(result)).toBe(true); expect(result.inputMode).toBe("payload"); expect(result.stdout.toString()).toBe(input);
  }
});
it("refuses a fast nonzero command and emits only finite lifecycle fields, never raw stderr", async () => {
  const result = await node("process.stderr.write('SYNTHETIC_SECRET_PATH_AND_VALUE');process.exit(7)");
  expect(succeeded(result)).toBe(false);
  const safe = diagnostic("command-0002", result);
  expect(safe).toMatchObject({ exitCode: 7, signal: null, errorCode: null, closeObserved: true, outEOF: true, errEOF: true, reason: "unclassified" });
  expect(JSON.stringify(safe)).not.toContain("SYNTHETIC_SECRET");
});
it("records a spawn failure with a finite OS code and never grants zero-exit acceptance", async () => {
  const result = await capture(join(tmpdir(), `nonexistent-usage-fixture-${randomUUID()}`), [], env);
  expect(succeeded(result)).toBe(false); expect(result).toMatchObject({ errorCode: "SPAWN_ENOENT", exitObserved: false, closeObserved: true });
  expect(JSON.stringify(diagnostic("command-0003", result))).not.toContain("nonexistent-usage-fixture");
});
it("refuses payload-pipe errors even when a child reports exit zero", async () => {
  const result = await node("process.exit(0)", "x".repeat(1024 * 1024));
  expect(result.exitCode).toBe(0); expect(result.errorCode).toMatch(/^STDIN_/); expect(succeeded(result)).toBe(false);
});
it("retains only the two existing expected SQL refusal categories without raw values", async () => {
  for (const [message, reason] of [["ERROR: usage_unavailable PRIVATE_VALUE", "usage_unavailable"], ["ERROR: permission denied for SECRET_RELATION", "permission denied"]]) {
    const result = await node(`process.stderr.write(${JSON.stringify(message)});process.exit(1)`);
    expect(succeeded(result)).toBe(false); const safe = diagnostic("command-0004", result);
    expect(safe.reason).toBe(reason); expect(JSON.stringify(safe)).not.toMatch(/PRIVATE_VALUE|SECRET_RELATION/);
  }
});
