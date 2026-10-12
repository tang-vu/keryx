import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts", "research-pilot.mts");
const args = ["--import", "tsx", script];

describe("read-only local pilot CLI", () => {
  it("has safe help without an input file or operator environment", () => {
    const help = execFileSync(process.execPath, [...args, "--help"], { encoding: "utf8" });
    expect(help).toContain("without loading environment, database, network or payment services");
    expect(help).toContain("not independently verified");
    expect(help).toContain("npm run research:pilot");
  });

  it("reads the illustrative empty template and emits aggregates only", () => {
    const output = execFileSync(process.execPath, [...args, "--input", "docs/research-pilot-template.json"], { encoding: "utf8" });
    const report = JSON.parse(output);
    expect(report.basis).toBe("illustrative");
    expect(report.tracks).toHaveLength(3);
    expect(report.overall.evidence.status).toBe("not-established");
    expect(report.overall.serviceFeeOnlyContribution.status).toBe("unknown");
  });

  it("rejects unknown/duplicate args without echoing values", () => {
    for (const invalid of [["--help", "private-value"], ["--input", "private-value", "--input", "other-value"],
      ["--write", "private-value"], ["--input", "--help"]]) {
      const result = spawnSync(process.execPath, [...args, ...invalid], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Private details omitted");
      expect(result.stderr).not.toContain("private-value");
    }
  });

  it("bounds bytes/type and refuses malformed UTF-8/JSON without exposing input", () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-pilot-cli-"));
    try {
      const scenarios = [
        ["oversize.json", Buffer.alloc(2 * 1024 * 1024 + 1, 32)],
        ["utf8.json", Buffer.from([0xff])],
        ["malformed.json", Buffer.from("private-example-value")],
        ["schema.json", Buffer.from(JSON.stringify({ secret: "private-example-value" }))],
        ["empty.json", Buffer.alloc(0)],
      ] as const;
      for (const [name, bytes] of scenarios) {
        const path = join(directory, name);
        writeFileSync(path, bytes);
        const result = spawnSync(process.execPath, [...args, "--input", path], { encoding: "utf8" });
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).not.toContain("private-example-value");
        expect(result.stderr).not.toContain(directory);
        expect(readFileSync(path)).toEqual(bytes);
      }
      expect(spawnSync(process.execPath, [...args, "--input", directory], { encoding: "utf8" }).status).toBe(1);
      if (process.platform !== "win32") {
        const fifo = join(directory, "pipe.json");
        execFileSync("mkfifo", [fifo]);
        const result = spawnSync(process.execPath, [...args, "--input", fifo], { encoding: "utf8", timeout: 3000 });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
      }
    } finally {
      // The only deletion is this test's verified generated temporary directory.
      expect(directory.startsWith(join(tmpdir(), "keryx-pilot-cli-"))).toBe(true);
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("refuses UNC, device namespaces and DOS aliases before either local CLI opens input", () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-specialist-input-alias-"));
    const forbidden = ["\\\\network-path-sentinel\\share\\input.json", "//network-path-sentinel/share/input.json",
      "\\\\?\\C:\\network-path-sentinel.json", "\\\\.\\pipe\\network-path-sentinel", "\\??\\network-path-sentinel",
      "CON.txt", "nul", "LPT1.json", "C:NUL", "C:CON.txt", "COM¹", "LPT².json", "folder/CONIN$",
      "folder/CONOUT$.txt", "https://network-path-sentinel/input.json", "-"];
    try {
      const preload = join(directory, "no-remote-open.mjs");
      writeFileSync(preload, `import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const original=fs.open,forbidden=new Set(${JSON.stringify(forbidden)});
fs.open=(path,...args)=>{if(forbidden.has(String(path))){process.stderr.write('FORBIDDEN_PATH_OPENED');throw Error('Forbidden input');}return original(path,...args)};
syncBuiltinESMExports();
globalThis.fetch=()=>{throw Error('Network forbidden by local CLI control')};\n`);
      const preloadUrl = pathToFileURL(preload).href;
      const control = spawnSync(process.execPath, ["--import", preloadUrl, "--input-type", "module", "--eval",
        "import {open} from 'node:fs/promises';try{await open('CON.txt')}catch{}"],
      { encoding: "utf8", timeout: 10_000, windowsHide: true });
      expect(control.error).toBeUndefined();
      expect(control.stderr).toContain("FORBIDDEN_PATH_OPENED");
      const brief = join(directory, "brief.json");
      writeFileSync(brief, JSON.stringify({ track: "api-platform", decision: "Compare two named APIs", context: "", sourceLeads: [] }));
      for (const [name, input] of [["research-pilot.mts", "docs/research-pilot-template.json"],
        ["prepare-specialist-brief.mts", brief]]) {
        const target = join(process.cwd(), "scripts", name);
        const run = (path: string) => spawnSync(process.execPath,
          ["--import", "tsx", "--import", preloadUrl, target, "--input", path],
          { encoding: "utf8", timeout: 10_000, windowsHide: true });
        expect(run(input).status).toBe(0);
        for (const path of forbidden) {
          const result = run(path);
          expect(result.error, `${name}: child completes`).toBeUndefined();
          expect(result.status, `${name}: unsafe path refuses`).toBe(1);
          expect(result.stdout).toBe("");
          expect(result.stderr).not.toContain("FORBIDDEN_PATH_OPENED");
          expect(result.stderr).not.toContain("network-path-sentinel");
        }
      }
    } finally {
      expect(directory.startsWith(join(tmpdir(), "keryx-specialist-input-alias-"))).toBe(true);
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
