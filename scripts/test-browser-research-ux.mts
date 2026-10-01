/** Run hermetic component checks and built-page Chromium checks with one offline Next server. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const port = 3957;
const base = process.env.KERYX_UX_BASE_URL ?? process.env.KERYX_TEST_BASE_URL ?? `http://127.0.0.1:${port}`;
const external = !!(process.env.KERYX_UX_BASE_URL || process.env.KERYX_TEST_BASE_URL);
const server = external ? null : spawn(process.execPath,
  [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: process.cwd(), env: { ...process.env, KERYX_FORCE_OFFLINE: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let output = "";
const exited = new Promise<void>(resolve => {
  if (!server) return resolve();
  server.once("exit", () => resolve());
  server.once("error", () => resolve());
  server.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-4096); });
  server.stderr.on("data", chunk => { output = (output + String(chunk)).slice(-4096); });
});

async function run(file: string) {
  console.log(`Running ${file}`);
  const child = spawn(process.execPath, ["--import", "tsx", file], {
    cwd: process.cwd(), env: { ...process.env, KERYX_UX_BASE_URL: base, KERYX_TEST_BASE_URL: base },
    stdio: "inherit", windowsHide: true,
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  assert.equal(code, 0, `${file} failed`);
}

try {
  await run("scripts/test-browser-research-form.mts");
  await run("scripts/test-browser-ask-isolation.mts");
  await run("scripts/test-browser-chat-payer.mts");
  await run("scripts/test-reading-evidence.mts");
  if (server) {
    let ready = false;
    for (let i = 0; i < 120 && server.exitCode === null; i++) {
      try { ready = (await fetch(base, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* server starting */ }
      if (ready) break;
      await delay(250);
    }
    assert(ready, `Local production server did not start: ${output}`);
  }
  await run("scripts/test-research-evidence-browser.mts");
  await run("scripts/test-browser-research-layout.mts");
  await run("scripts/test-browser-research-chat.mts");
  await run("scripts/test-reading-ux-browser.mts");
} finally {
  if (server) { server.kill(); await exited; }
}
