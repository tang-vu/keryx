/** Actual built Next through a synthetic reverse proxy; no cookies, keys, signing or payments. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url), port = 3954, base = `http://127.0.0.1:${port}`;
const externalOrigin = "https://sponsor-framework.invalid";
const env = { ...process.env, BASE_URL: externalOrigin, KERYX_FORCE_OFFLINE: "1",
  SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
  KERYX_REGISTRY_ADDRESS: "", KERYX_REGISTRY_READ_ADDRESS: "",
  KERYX_REGISTRATION_SPONSOR_POLICY: "", KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY: "" };
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: process.cwd(), env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
});
let ready = false, spawnFailed = false;
child.stdout.on("data", chunk => { ready ||= /Ready in/i.test(String(chunk)); });
const exited = new Promise<void>(resolve => {
  child.once("close", () => resolve()); child.once("error", () => { spawnFailed = true; });
});
try {
  for (let i = 0; i < 120 && !ready && !spawnFailed && child.exitCode === null; i++) await delay(250);
  assert(ready && !spawnFailed && child.exitCode === null, "Isolated Next framework server did not start");
  for (const [origin, status] of [[externalOrigin, 401], ["https://foreign.invalid", 403], ["null", 403], [undefined, 403]] as const) {
    const headers: Record<string, string> = { "content-type": "application/json", host: "sponsor-framework.invalid",
      "x-forwarded-host": "sponsor-framework.invalid", "x-forwarded-proto": "https" };
    if (origin) headers.origin = origin;
    const response = await fetch(`${base}/api/sources/sponsor`, { method: "POST", redirect: "error", headers,
      body: JSON.stringify({ operation: "prepare", claimId: "a".repeat(64), fetchPrice: 0.016 }), signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status, `Configured Origin must reach authentication through the reverse proxy; origin=${origin}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert(response.headers.get("vary")?.includes("Cookie"));
    await response.body?.cancel();
  }
  const disabled = await fetch(`${base}/api/sources/sponsor`, { signal: AbortSignal.timeout(10000) });
  assert.equal(disabled.status, 200); assert.deepEqual(await disabled.json(), { available: false });
  const page = await fetch(`${base}/register/sponsored`, { signal: AbortSignal.timeout(10000) });
  assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  await page.body?.cancel();
  console.log("PASS: actual Next sponsor route accepts the configured browser Origin behind a proxy, rejects foreign/null/missing Origin despite forwarded headers, requires SIWE and stays disabled without policy.");
} finally { child.kill(); await exited; }
