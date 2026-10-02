import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { candidate } from "./mainnet-pilot-candidate-fixture";

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/preflight-mainnet-pilot.mts", ...args],
    { cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
      env: { ...process.env, KERYX_NETWORK: "arc", KERYX_FORCE_OFFLINE: "0", KERYX_AGENT_PRIVATE_KEY: "do-not-read-custody" } });
}
it("executes the real offline command without importing testnet runtime or environment custody", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keryx-pilot-test-")); folders.push(folder);
  const file = join(folder, "candidate.json"); await writeFile(file, JSON.stringify(candidate()));
  const process = run(["--candidate", file]);
  expect(process.status).toBe(0); expect(process.stderr).toBe("");
  expect(JSON.parse(process.stdout)).toMatchObject({ candidateAccepted: true, mainnetReady: false,
    launchAuthorized: false, externalEvidence: "not_requested" });
  expect(process.stdout).not.toContain("do-not-read-custody");
});
it("refuses malformed and oversize files with fixed errors, never echoing paths or body", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keryx-pilot-test-")); folders.push(folder);
  const file = join(folder, "private-secret-file.json");
  for (const content of ["private-secret", "x".repeat(16_385)]) {
    await writeFile(file, content); const process = run(["--candidate", file]);
    expect(process.status).toBe(2); expect(process.stdout).toBe("");
    expect(process.stderr).toBe("Candidate file unavailable or refused; no private detail retained.\n");
  }
});
it("refuses unknown arguments and provides keyless help", () => {
  expect(run(["--candidate", "never-open-this", "--launch"]).status).toBe(2);
  const help = run(["--help"]); expect(help.status).toBe(0); expect(help.stdout).toContain("Never enables or authorizes mainnet");
});
it("refuses directory and unavailable paths with bounded fixed errors", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keryx-pilot-test-")); folders.push(folder);
  for (const file of [folder, join(folder, "private-missing-path")]) {
    const process = run(["--candidate", file]); expect(process.status).toBe(2);
    expect(process.stderr).not.toContain(file); expect(process.stdout).toBe("");
  }
});
it.skipIf(process.platform === "win32")("refuses FIFO and symbolic-link inputs before blocking open", async () => {
  const folder = await mkdtemp(join(tmpdir(), "keryx-pilot-test-")); folders.push(folder);
  const fifo = join(folder, "private-fifo");
  expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
  const result = run(["--candidate", fifo]); expect(result.status).toBe(2); expect(result.error).toBeUndefined();
  const file = join(folder, "candidate.json"); await writeFile(file, JSON.stringify(candidate()));
  const link = join(folder, "candidate-link.json"); await symlink(file, link);
  expect(run(["--candidate", link]).status).toBe(2);
});
