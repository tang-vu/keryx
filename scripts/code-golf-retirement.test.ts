import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("retires the actual minimal SDK CLI before accessing custody or network", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "code-golf-retired-"));
  const script = fileURLToPath(new URL("./code-golf-agent.mts", import.meta.url));
  const env = { NODE_ENV: "test" as const, ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) };
  try {
    let refused: unknown;
    try { await promisify(execFile)(process.execPath, [script, "https://unavailable.invalid"], { cwd: directory, env, timeout: 8000 }); }
    catch (error) { refused = error; }
    expect(refused).toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("Legacy code-golf payment is disabled") });
    const help = await promisify(execFile)(process.execPath, [script, "--help"], { cwd: directory, env, timeout: 8000 });
    expect(help.stdout).toContain("npm run buyer -- --help"); expect(help.stderr).toBe("");
    expect(await fs.readdir(directory)).toEqual([]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
