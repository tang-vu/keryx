import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
