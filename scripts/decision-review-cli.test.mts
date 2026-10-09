import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dirname, "..");
it.each(["ask.mts", "web-client.mts"])("%s refuses review-first in an isolated process before agent output", script => {
  const cwd = mkdtempSync(join(tmpdir(), "keryx-review-cli-"));
  try {
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), join(root, "scripts", script), "Synthetic question", "--review-first"], {
      cwd, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
        KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1", KERYX_EXTERNAL_DISCOVERY: "0",
        NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" } });
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Review-first requires|Headless web client unavailable/);
    expect(result.stdout).not.toMatch(/engine:|run id:|Answer|sign-request/);
  } finally { if (resolve(cwd).startsWith(resolve(tmpdir(), "keryx-review-cli-"))) rmSync(cwd, { recursive: true, force: true }); }
});
