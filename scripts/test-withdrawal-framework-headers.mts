/** Check an already-built Next app on loopback. No cookies, wallet, signing or payment. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url), port = 3947, base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
});
let ready = false, spawnFailed = false, output = "";
child.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-4096); ready ||= /Ready in/i.test(output); });
const exited = new Promise<void>(resolve => {
  child.once("exit", () => resolve()); child.once("error", () => { spawnFailed = true; resolve(); });
});
try {
  for (let i = 0; i < 120 && !ready && !spawnFailed && child.exitCode === null; i++) await delay(250);
  assert.ok(ready && !spawnFailed && child.exitCode === null, "Local production server did not start");
  for (const [origin, status] of [[base, 401], ["https://foreign.invalid", 403]] as const) {
    const response = await fetch(`${base}/api/me/withdrawals/history`, { method: "POST", redirect: "error",
      headers: { origin, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.headers.get("vary")?.includes("Cookie"));
    await response.body?.cancel();
  }
  const page = await fetch(`${base}/me/withdrawals`, { redirect: "error", signal: AbortSignal.timeout(10000) });
  assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  assert.ok((await page.text()).includes("Account history shows requests saved on the server"));
  const economics = await fetch(`${base}/api/economics`, { redirect: "error", signal: AbortSignal.timeout(10000) });
  assert.equal(economics.status, 410); assert.equal(economics.headers.get("cache-control"), "no-store");
  assert.deepEqual(await economics.json(), { error: "Operational economics are private.", calculator: "/economics" });
  console.log("PASS: production Next withdrawal history authentication/private headers and retired operational economics endpoint.");
} finally { child.kill(); await exited; }
