import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SPONSORED_HELPER_TIMEOUT_MS } from "./helper-protocol";
import type { SponsoredResearchOutcome } from "./contracts";

const desktop = resolve(import.meta.dirname, "..");

// Exercise the real helper entrypoint and shared transport over its serial wire.
// Only fetch is replaced, inside a disposable child; no hosted request can run.
const fakeTransport = `
const assert = require("node:assert/strict");
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = ms => { assert.equal(ms, 300000); return realTimeout(30); };
let posts = 0;
globalThis.fetch = async (url, options) => {
  if (++posts !== 1) process.exit(9);
  assert.equal(url, "https://keryx.cc/api/v1/chat/completions");
  assert.equal(options.headers.Authorization, "Bearer keryx");
  assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
  assert.deepEqual(JSON.parse(options.body), { model: "keryx", stream: true,
    messages: [{role:"user",content:"Public helper question"}], mode:"quick", budget:0, publicReport:true });
  const kind = process.env.KERYX_TEST_SPONSORED_CASE;
  if (kind === "timeout") return new Promise(() => {});
  if (kind === "429" || kind === "503") return new Response(JSON.stringify({ error: {
    code: "sponsored_limit", message: "Sponsored research is unavailable" } }), { status: Number(kind) });
  const id = "11111111-1111-4111-8111-111111111111";
  const chunk = (delta, finish_reason = null, extra = {}) => ({id: "chatcmpl-" + id,
    choices: [{delta, finish_reason}], ...extra});
  const frames = [chunk({role:"assistant"}), chunk({content:"Public helper answer"})];
  if (kind !== "incomplete") frames.push(chunk({}, "stop", {keryx: {queryId:id,
    dispatchUrl:"https://keryx.cc/dispatch/" + id, citations:[], paymentMode:"real"},
    keryx_private: {claimTicket:"fake-private-ticket"}}));
  return new Response(frames.map(value => "data: " + JSON.stringify(value) + "\\n\\n").join("") +
    (kind === "incomplete" ? "" : "data: [DONE]\\n\\n"), { headers: {"Content-Type":"text/event-stream"} });
};
`;

describe("sponsored helper serial transport", () => {
  let temporary: string;
  let helper: string;
  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), "keryx-sponsored-helper-"));
    helper = join(temporary, "helper.cjs");
    await build({ entryPoints: [join(desktop, "src/helper.ts")], bundle: true, platform: "node", target: "node24", format: "cjs",
      outfile: helper, logLevel: "silent", banner: { js: fakeTransport }, define: { KERYX_NATIVE_SOURCE_COMMIT: JSON.stringify("a".repeat(40)) } });
  });
  afterAll(async () => {
    const target = resolve(temporary), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep) || !basename(target).startsWith("keryx-sponsored-helper-")) throw Error("Unexpected temporary helper path");
    await rm(target, { recursive: true, force: true });
  });
  async function exchange(kind: string, input: unknown = { question: "Public helper question", mode: "quick", budget: 0, publicReport: true }) {
    const requests = [
      { id: 1, action: "init", payload: JSON.stringify({ sourceCommit: "a".repeat(40), nativeBinary: join(temporary, "absent-engine.exe"),
        nativeManifest: join(temporary, "absent-manifest.json"), selectionFile: join(temporary, "absent-selection.json"), legacySelectionFile: null }) },
      { id: 2, action: "refresh", payload: "{}" },
      { id: 3, action: "research_sponsored", payload: JSON.stringify({ input }) },
      { id: 4, action: "refresh", payload: "{}" },
    ];
    const before = await readdir(temporary);
    const child = spawn(process.execPath, [helper], { windowsHide: true, env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      KERYX_TEST_SPONSORED_CASE: kind, KERYX_API_KEY: "fixture-must-never-be-forwarded",
    }, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    const exit = new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
    child.stdin.end(requests.map(value => JSON.stringify(value) + "\n").join(""));
    const timer = setTimeout(() => child.kill(), 8000);
    try { expect(await exit, stderr).toBe(0); } finally { clearTimeout(timer); }
    expect(await readdir(temporary)).toEqual(before); // No selection/task/journal writes.
    const frames = stdout.trim().split("\n").map(line => JSON.parse(line));
    expect(frames.map(frame => frame.id)).toEqual([1, 2, 3, 4]);
    expect(JSON.parse(frames[1].result)).toBeNull(); expect(JSON.parse(frames[3].result)).toBeNull();
    return frames[2];
  }

  it("uses only the fixed public request and returns no claim tickets without selecting or writing a workspace", async () => {
    const frame = await exchange("success");
    expect(frame.ok).toBe(true);
    const outcome = JSON.parse(frame.result) as SponsoredResearchOutcome;
    expect(outcome.ok && outcome.result.answer).toBe("Public helper answer");
    expect(frame.result).not.toContain("fake-private-ticket"); expect(frame.result).not.toContain("claimTicket");
  });
  it.each(["429", "503"])("preserves a confirmed HTTP %s refusal", async kind => {
    const frame = await exchange(kind), outcome = JSON.parse(frame.result) as SponsoredResearchOutcome;
    expect(outcome).toMatchObject({ ok: false, uncertain: false, message: "Sponsored research is unavailable" });
  });
  it.each(["incomplete", "timeout"])("preserves uncertainty for %s and never retries", async kind => {
    const frame = await exchange(kind), outcome = JSON.parse(frame.result) as SponsoredResearchOutcome;
    expect(outcome).toMatchObject({ ok: false, uncertain: true });
    if (kind === "incomplete") expect(outcome).toMatchObject({ queryId: "11111111-1111-4111-8111-111111111111",
      dispatchUrl: "https://keryx.cc/dispatch/11111111-1111-4111-8111-111111111111" });
  });
  it("refuses workspace fields at the real helper boundary", async () => {
    const frame = await exchange("success", { question: "Public helper question", mode: "quick", budget: 0, publicReport: true, workspace: "PRIVATE LOCAL CONTENT" });
    expect(frame.ok).toBe(false); expect(frame.error).toContain("explicit public-report consent");
  });
  it("keeps the host deadline beyond the helper deadline and requires the trusted window", async () => {
    const protocol = await readFile(join(desktop, "src-tauri/src/helper_protocol.rs"), "utf8");
    const hostSeconds = Number(protocol.match(/SPONSORED_TIMEOUT_SECS: u64 = (\d+)/)?.[1]);
    expect(hostSeconds * 1000).toBeGreaterThan(SPONSORED_HELPER_TIMEOUT_MS);
    expect(hostSeconds).toBeLessThanOrEqual(360);
    const source = await readFile(join(desktop, "src-tauri/src/lib.rs"), "utf8");
    expect(source).toMatch(/async fn research_sponsored\([\s\S]*?check_caller\(&window\)\?;[\s\S]*?sponsored_payload\(&input\)\?;/);
  });
});
