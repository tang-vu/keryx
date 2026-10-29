import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "keryx-ask-help-"));
const guard = join(directory, "guard.mjs");
writeFileSync(guard, `
import { registerHooks } from 'node:module';
process.stderr.write('CLI_HELP_GUARD_ARMED\\n');
globalThis.fetch = () => { throw new Error('CLI_NETWORK_BLOCKED'); };
registerHooks({ resolve(specifier, context, next) {
  const value = String(specifier).replaceAll('\\\\', '/');
  if (/\\/lib\\/(?:agent\\/index|llm\\/(?:index|research-plan|research-selection|reasoning-telemetry)|run-claims\\/hosted-delivery|db(?:\\/|\\.))/u.test(value))
    throw new Error('CLI_EXECUTION_GRAPH_BLOCKED');
  return next(specifier, context);
} });
`);
afterAll(() => { unlinkSync(guard); rmdirSync(directory); });

function invoke(args: string[], claims = false) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1",
    KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED: String(claims), NO_COLOR: "1", TEMP: tmpdir(), TMP: tmpdir(), TMPDIR: tmpdir() };
  for (const key of ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "NODE_COMPILE_CACHE"]) {
    const value = process.env[key]; if (value !== undefined) env[key] = value;
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", "--import", pathToFileURL(guard).href, "--no-warnings", "scripts/ask.mts", ...args],
    { cwd, env, encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024 });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toContain("CLI_HELP_GUARD_ARMED");
  expect(result.stderr).not.toContain("CLI_NETWORK_BLOCKED");
  return result;
}

it.each(["--help", "-h"])("prints successful keyless ask help for %s without loading execution", flag => {
  const result = invoke([flag]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Usage: npm run ask --");
  for (const option of ["--budget", "--model", "--web", "--language", "--private-claim-fd"]) expect(result.stdout).toContain(option);
  expect(result.stdout).toContain("hi, id or ru.");
  expect(result.stdout).toContain("Model and search operating costs are separate");
  expect(result.stderr).not.toContain("CLI_EXECUTION_GRAPH_BLOCKED");
});

it("keeps help independent of claim pipes and does not echo ignored arguments", () => {
  const result = invoke(["--private-claim-fd", "1", "--model", "PRIVATE_HELP_INPUT", "--help", "PRIVATE_QUESTION"], true);
  expect(result.status).toBe(0); expect(result.stdout).toContain("Usage: npm run ask --");
  expect(result.stdout + result.stderr).not.toMatch(/PRIVATE_HELP_INPUT|PRIVATE_QUESTION|private_claim_output|CLI_EXECUTION_GRAPH_BLOCKED/);
});

it("retains unknown-option refusal before execution", () => {
  const result = invoke(["--not-an-option"]);
  expect(result.status).not.toBe(0); expect(result.stderr).toContain("Unsupported option");
  expect(result.stderr).not.toContain("CLI_EXECUTION_GRAPH_BLOCKED");
});

it("retains invalid-budget refusal before execution", () => {
  const result = invoke(["--budget", "not-a-budget"]);
  expect(result.status).not.toBe(0); expect(result.stderr).toContain("--budget requires");
  expect(result.stderr).not.toContain("CLI_EXECUTION_GRAPH_BLOCKED");
});

it("preserves execution intent for an ordinary valid question while the guard prevents effects", () => {
  const result = invoke(["--budget", "0", "A synthetic research question"]);
  expect(result.status).not.toBe(0); expect(result.stderr).toContain("CLI_EXECUTION_GRAPH_BLOCKED");
  expect(result.stdout).not.toContain("Usage: npm run ask --");
});
