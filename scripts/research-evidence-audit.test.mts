import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

let directory: string, input: string;
const script = fileURLToPath(new URL("./research-evidence-audit.mts", import.meta.url));
function command(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "--import", pathToFileURL(join(directory, "no-fetch.mjs")).href, script, ...args],
    { cwd: process.cwd(), env: { ...process.env, KERYX_PRIVATE_KEY: "private-environment-sentinel" }, encoding: "utf8", timeout: 10_000, windowsHide: true });
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "keryx-evidence-audit-cli-")); input = join(directory, "input.json");
  await writeFile(input, await readFile(new URL("../docs/research-evidence-audit-example.json", import.meta.url)));
  await writeFile(join(directory, "no-fetch.mjs"), `import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const original=fs.open;
const aliases=new Set(['CON.txt','nul','LPT1.json','C:NUL','C:CON.txt','COM¹','LPT².json']);
fs.open=(path,...args)=>{if(String(path).includes('network-path-sentinel')||aliases.has(String(path))){process.stderr.write('FORBIDDEN_PATH_OPENED');throw Error('Forbidden path');}return original(path,...args)};
syncBuiltinESMExports();
globalThis.fetch=()=>{throw Error('Network forbidden by offline CLI fixture')};\n`);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

it("uses the same offline scorer in a fresh process with no fetch or environment dependency", () => {
  const result = command([input]); expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ schema: "keryx-evidence-audit-v1", network: "eip155:5042002", receiptCheck: "self-check-only",
    economics: { sourceCostPerSupportedClaim: null, providerCostPerSupportedClaim: null } });
  expect(result.stdout + result.stderr).not.toContain("private-environment-sentinel");
});

it("checks separate trust data and rejects a recomputed but differently retained receipt", async () => {
  const data = JSON.parse(await readFile(input, "utf8")), trust = join(directory, "trust.json");
  await writeFile(trust, JSON.stringify({ expectedReceiptDigest: data.receipt.integrity.digest }));
  expect(JSON.parse(command([input, "--trust", trust]).stdout).receiptCheck).toBe("retained-digest-match");
  await writeFile(trust, JSON.stringify({ expectedReceiptDigest: "sha256:" + "f".repeat(64) }));
  const result = command([input, "--trust", trust]); expect(result.status).toBe(1); expect(result.stdout).toBe("");
});

it("refuses bad arguments, URLs, directories, large/invalid UTF-8 and private malformed inputs without echoing them", async () => {
  const file = join(directory, "private-sentinel-path.json");
  for (const bytes of [Buffer.alloc(1_048_577, 32), Buffer.from([0xff, 0xfe]), Buffer.from('{"private":"private-content-sentinel"}')]) {
    await writeFile(file, bytes);
    const result = command([file]); expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).not.toMatch(/private-sentinel-path|private-content-sentinel/);
  }
  for (const args of [[], [directory], ["https://example.com/private"], ["-"], [input, "--trust"], [input, "--unknown", file], [input, "extra"]]) {
    const result = command(args); expect(result.error).toBeUndefined(); expect(result.status).toBe(1); expect(result.stdout).toBe("");
  }
  expect(command(["--help"]).status).toBe(0);
});

it("refuses UNC, device namespaces and DOS device aliases before attempting filesystem I/O", () => {
  const control = spawnSync(process.execPath, ["--import", pathToFileURL(join(directory, "no-fetch.mjs")).href,
    "--input-type", "module", "--eval", "import {open} from 'node:fs/promises'; try { await open('CON.txt'); } catch {}"],
    { encoding: "utf8", timeout: 10_000, windowsHide: true });
  expect(control.stderr).toContain("FORBIDDEN_PATH_OPENED"); // The probe really sees named fs.open, without opening a device.
  for (const path of ["\\\\network-path-sentinel\\share\\input.json", "//network-path-sentinel/share/input.json",
    "\\\\?\\C:\\network-path-sentinel.json", "\\\\.\\pipe\\network-path-sentinel", "\\??\\network-path-sentinel", "CON.txt", "nul", "LPT1.json",
    "C:NUL", "C:CON.txt", "COM¹", "LPT².json"]) {
    const result = command([path]); expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("FORBIDDEN_PATH_OPENED");
  }
});
