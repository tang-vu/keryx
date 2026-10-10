import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type StdioOptions } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { parsePrivateCliClaimFd, preparePrivateCliClaim } from "./private-cli-claims.mts";
import { privateRunClaimPacketSchema } from "../lib/run-claims/delivery.ts";

const root = resolve(import.meta.dirname, ".."), enabled = { KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED: "true" };
const held: string[] = [];
afterEach(() => { for (const dir of held.splice(0)) {
  if (!resolve(dir).startsWith(resolve(tmpdir(), "keryx-private-cli-"))) throw Error("Unexpected fixture path");
  rmSync(dir, { recursive: true, force: true });
} });
async function cli(mode: string, args = ["--private-claim-fd", "3"], sink: "pipe" | "regular" | "public-pipes" | "public-alias" | "read-end" = "pipe") {
  const cwd = mkdtempSync(join(tmpdir(), "keryx-private-cli-")); held.push(cwd);
  const regular = sink === "regular", file = join(cwd, "regular-output.fixture"), parentFd = regular ? openSync(file, "wx") : undefined;
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    NODE_NO_WARNINGS: "1", KERYX_CLI_CLAIM_FIXTURE_CASE: mode,
    KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED: mode === "off" ? "false" : "true" };
  const stdoutFile = join(cwd, "public-stdout.fixture"), stderrFile = join(cwd, "public-stderr.fixture");
  const publicFiles = sink !== "public-pipes" && sink !== "public-alias";
  const publicFd1 = publicFiles ? openSync(stdoutFile, "wx") : undefined;
  const publicFd2 = publicFiles ? openSync(stderrFile, "wx") : undefined;
  const alias = sink === "public-alias" ? spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"],
    { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }) : undefined;
  const aliasChunks: Buffer[] = []; let aliasEnd = false;
  alias?.stdout.on("data", (bytes: Buffer) => { aliasChunks.push(bytes); });
  alias?.stdout.on("end", () => { aliasEnd = true; });
  let readFd: number | undefined, readBytes = 0;
  const server = sink === "read-end" ? createServer(socket => { socket.on("data", bytes => { readBytes += bytes.length; }); }) : undefined;
  if (server) {
    const pipe = `\\\\.\\pipe\\keryx-private-cli-read-${randomUUID()}`;
    await new Promise<void>(done => server.listen(pipe, done)); readFd = openSync(pipe, "r");
  }
  const stdio: StdioOptions = ["ignore", alias?.stdin ?? publicFd1 ?? "pipe", publicFd2 ?? "pipe",
    alias?.stdin ?? readFd ?? parentFd ?? "pipe", "pipe"];
  const entry = mode === "repeat" ? ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {preparePrivateCliClaim} from '${pathToFileURL(join(root, "scripts/private-cli-claims.mts")).href}';
    const api=globalThis.__keryxPrivateCliClaimFixture;
    const prepared=await preparePrivateCliClaim({env:process.env,fd:3,prepare:api.prepareHostedRunClaim});
    const run=await api.collectRun({queryId:prepared.queryId,question:'Synthetic repeat',provenance:{version:1,surface:'cli',ownershipMethod:'unknown'}},{onStep(){}});
    assert.equal(await prepared.complete(run),'written');
    assert.equal(await prepared.complete(run),'unavailable');
    process.exit(0);`] : [join(root, "scripts/ask.mts"), "Synthetic caller wallet 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ...args];
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--import",
    pathToFileURL(join(root, "scripts/private-cli-claims.test-fixture.mts")).href,
    ...entry],
  { cwd, env, stdio, windowsHide: true });
  for (const fd of [parentFd, publicFd1, publicFd2, readFd]) if (fd !== undefined) closeSync(fd);
  const data = ["", "", "", ""], eof: (boolean | null)[] = [publicFiles || alias ? null : false, publicFiles ? null : false,
    regular || readFd !== undefined || alias ? null : false, false];
  let overflow = false, timedOut = false, errorCode: string | undefined;
  for (let i = 0; i < 4; i++) {
    const stream = child.stdio[i + 1];
    if (stream && "on" in stream) {
      stream.on("data", (bytes: Buffer) => { data[i] += bytes.toString("utf8"); if (Buffer.byteLength(data[i]) > 65536) { overflow = true; child.kill(); } });
      stream.on("end", () => { eof[i] = true; });
      stream.on("error", () => { errorCode = "STREAM_ERROR"; });
    }
  }
  child.on("error", () => { errorCode = "PROCESS_ERROR"; });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 12000);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(done =>
    child.on("close", (code, signal) => { clearTimeout(timer); done({ code, signal }); }));
  if (alias) {
    alias.stdin.end(); const code = await new Promise<number | null>(done => alias.on("close", done));
    expect(code).toBe(0); expect(aliasEnd).toBe(true); data[2] = Buffer.concat(aliasChunks).toString("utf8");
  }
  if (server) { await new Promise<void>(done => server.close(() => done())); expect(readBytes).toBe(0); }
  if (publicFiles) { data[0] = readFileSync(stdoutFile, "utf8"); data[1] = readFileSync(stderrFile, "utf8"); }
  expect(errorCode).toBeUndefined(); expect(overflow).toBe(false); expect(timedOut).toBe(false);
  expect(result.signal).toBeNull(); expect(eof.every(value => value === true || value === null)).toBe(true);
  for (const value of data) expect(Buffer.byteLength(value)).toBeLessThanOrEqual(65536);
  const events = data[3].trim() ? data[3].trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>) : [];
  return { ...result, stdout: data[0], stderr: data[1], privateOutput: data[2], events,
    final: events.find(e => e.event === "final"), regularBytes: regular ? readFileSync(file).length : null };
}

describe("direct CLI private claims", () => {
  it("default-off does not prepare a store, and explicit output cannot enable claims", async () => {
    const prepare = vi.fn(async () => { throw Error("must not open"); });
    expect(await preparePrivateCliClaim({ env: {}, prepare })).toBeNull();
    await expect(preparePrivateCliClaim({ env: {}, fd: 3, prepare })).rejects.toThrow(/^claims_unavailable$/);
    expect(prepare).not.toHaveBeenCalled();
    const legacy = await cli("off", []);
    expect(legacy.code).toBe(0); expect(legacy.stderr).toBe(""); expect(legacy.privateOutput).toBe("");
    expect(legacy.stdout).toContain("Saved synthetic answer"); expect(legacy.stdout).not.toContain("account claim");
    expect(legacy.events.map(e => e.event)).toEqual(["provider", "research", "persist", "final"]);
    const refused = await cli("off"); expect(refused.code).toBe(1); expect(refused.stdout).toBe("");
    expect(refused.events).toEqual([]); expect(refused.stderr).toContain("claims_unavailable");
  });
  it("uses only canonical finite private descriptor selectors", () => {
    for (const value of ["3", "9", "10", "59", "63"]) expect(parsePrivateCliClaimFd(value)).toBe(Number(value));
    for (const value of [undefined, "", "0", "1", "2", "64", "03", " 3", "3 ", "3.0", "-3", "Infinity", "SYNTHETIC_PRIVATE_VALUE"])
      expect(() => parsePrivateCliClaimFd(value)).toThrow(/^private_claim_output_unavailable$/);
  });
  it.each([[], ["--private-claim-fd", "1"], ["--private-claim-fd", "63"], ["--wallet", "0x" + "a".repeat(40)]].map(args => ({ args })))(
    "refuses unsupported intent $args before preparation or providers", async ({ args }) => {
      const value = await cli("success", args);
      expect(value.code).toBe(1); expect(value.stdout).toBe(""); expect(value.privateOutput).toBe(""); expect(value.events).toEqual([]);
      expect(value.stderr).not.toContain("UNEXPECTED_APPLICATION_GRAPH");
    });
  it("refuses a regular output file before preparation and leaves it empty", async () => {
    const value = await cli("success", undefined, "regular");
    expect(value.code).toBe(1); expect(value.stdout).toBe(""); expect(value.events).toEqual([]);
    expect(value.regularBytes).toBe(0); expect(value.stderr).toContain("private_claim_output_unavailable");
  });
  it("refuses a missing ordinary capability before provider loading, without native fallback", async () => {
    const value = await cli("native");
    expect(value.code).toBe(1); expect(value.stdout).toBe(""); expect(value.privateOutput).toBe("");
    expect(value.events.map(e => e.event)).toEqual(["prepare", "final"]); expect(value.stderr).toContain("claims_unavailable");
    expect(value.final?.claimCount).toBe(0); expect(value.final?.saved).toBe(false);
  });
  it("delivers one real isolated SQLite claim over an inherited pipe after persistence, with unknown CLI authority", async () => {
    const value = await cli("success"); expect(value.code).toBe(0); expect(value.stderr).toBe("");
    expect(value.events.map(e => e.event)).toEqual(["prepare", "provider", "research", "persist", "issue-after-persist", "final"]);
    const packet = privateRunClaimPacketSchema.parse(JSON.parse(value.privateOutput));
    expect(packet.status).toBe("available"); if (packet.status !== "available") throw Error("Missing synthetic packet");
    const token = new URL(packet.delivery.claimUrl).hash.slice(1);
    expect(value.stdout).toContain("Saved synthetic answer"); expect(value.stdout).toContain("Private account claim written once");
    expect(value.stdout + value.stderr).not.toContain(token); expect(value.stdout).not.toContain("claim-run#");
    expect(value.privateOutput.trim().split("\n")).toHaveLength(1);
    expect(value.final).toMatchObject({ claimCount: 1, saved: true, originalUnchanged: true, financialUnchanged: true, hashesOnly: true });
    expect(value.final?.fd3Type).toBe(0o010000); // Actual inherited Windows/Linux FIFO, no hypothetical platform admission.
  });
  it.each(["late-issue", "closed-output", "replaced-output"])("preserves a completed answer on %s without retry or credential logging", async mode => {
    const value = await cli(mode); expect(value.code).toBe(0); expect(value.stderr).toBe("");
    expect(value.stdout).toContain("Saved synthetic answer"); expect(value.stdout).toContain("private account claim is unavailable");
    expect(value.stdout).not.toContain("SYNTHETIC_PRIVATE_BACKEND_BODY"); expect(value.stdout).not.toContain("claim-run#");
    expect(value.final).toMatchObject({ saved: true, originalUnchanged: true, financialUnchanged: true });
    const count = value.events.filter(e => e.event === "issue-after-persist").length;
    expect(count).toBe(mode === "closed-output" ? 0 : 1);
    expect(value.final?.claimCount).toBe(mode === "replaced-output" ? 1 : 0);
    if (mode === "late-issue") expect(privateRunClaimPacketSchema.parse(JSON.parse(value.privateOutput)).status).toBe("unavailable");
    else expect(value.privateOutput).toBe("");
  });
  it("never issues a claim when the original save fails", async () => {
    const value = await cli("save-failure"); expect(value.code).toBe(1); expect(value.privateOutput).toBe("");
    expect(value.events.map(e => e.event)).toEqual(["prepare", "provider", "research", "final"]);
    expect(value.final).toMatchObject({ saved: false, claimCount: 0 });
  });
  it("completes at most once and never retries issuance or writes a second packet", async () => {
    const value = await cli("repeat"); expect(value.code).toBe(0); expect(value.stderr).toBe("");
    expect(value.events.map(e => e.event)).toEqual(["prepare", "research", "persist", "issue-after-persist", "final"]);
    expect(value.privateOutput.trim().split("\n")).toHaveLength(1);
    expect(value.final).toMatchObject({ claimCount: 1, originalUnchanged: true, financialUnchanged: true });
  });
  it("refuses an actual stdout/private-pipe alias before preparation or providers", async () => {
    const value = await cli("success", undefined, "public-alias");
    expect(value.code).toBe(1); expect(value.privateOutput).toBe(""); expect(value.events).toEqual([]);
    expect(value.stderr).toContain("private_claim_output_unavailable");
  });
  it.skipIf(process.platform !== "win32")("refuses public pipes on Windows even when distinct", async () => {
    const value = await cli("success", undefined, "public-pipes");
    expect(value.code).toBe(1); expect(value.stdout).toBe(""); expect(value.events).toEqual([]);
  });
  it.skipIf(process.platform !== "win32")("refuses an actual inherited read-only Windows named-pipe endpoint before preparation", async () => {
    const value = await cli("success", undefined, "read-end");
    expect(value.code).toBe(1); expect(value.stdout).toBe(""); expect(value.events).toEqual([]);
    expect(value.stderr).toContain("private_claim_output_unavailable");
  });
});
