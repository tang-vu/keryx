import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const bundle = await readFile(new URL(".wrangler/build/index.js", import.meta.url), "utf8");
const token = "x".repeat(43);
const storage = await mkdtemp(join(tmpdir(), "keryx-monitor-"));
const outbound = [];
let healthStatus = 503;
let telegramMode = "confirmed";
let scheduledTime = Math.floor(Date.now() / 300_000) * 300_000;
let runtime;

function createRuntime(notifications = "true", runId = "runtime-acceptance") {
  return new Miniflare(convertV4MiniflareOptions({
    name: "keryx-ops-monitor", compatibilityDate: "2026-09-30", resourcePersistencePath: storage,
    modules: [
      { type: "ESModule", path: "harness.mjs", contents: `
        import worker, { MonitorState } from './worker.mjs';
        export { MonitorState };
        export default { async fetch(request, env) {
          const url = new URL(request.url);
          if(url.pathname === '/__cron') {
            try { await worker.scheduled({scheduledTime:Number(url.searchParams.get('time'))}, env);
              return Response.json({status:'completed'}); }
            catch { return Response.json({status:'failed'}, {status:503}); }
          }
          return worker.fetch(request,env);
        }};` },
      { type: "ESModule", path: "worker.mjs", contents: bundle },
    ],
    durableObjects: { MONITOR: { className: "MonitorState", useSQLite: true } },
    bindings: { MONITOR_DIAGNOSTIC_TOKEN: token, ALERT_TELEGRAM_BOT_TOKEN: `123:${"x".repeat(30)}`,
      ALERT_TELEGRAM_CHAT_ID: "-123", DIAGNOSTIC_RUN_ID: runId,
      DIAGNOSTIC_NOTIFICATIONS_ENABLED: notifications },
    outboundService: async request => {
      const url = new URL(request.url);
      outbound.push({ url: request.url, method: request.method, body: request.method === "POST" ? await request.json() : null });
      if (url.hostname === "keryx.cc") {
        assert.equal(request.url, "https://keryx.cc/api/health");
        assert.equal(request.headers.get("authorization"), null);
        return healthStatus === 200
          ? Response.json({ name: "keryx", ok: true, db: "ok", status: "operational", time: new Date().toISOString() })
          : new Response(null, { status: healthStatus,
            ...(healthStatus === 302 ? { headers: { Location: "https://evil.invalid" } } : {}) });
      }
      assert.equal(url.hostname, "api.telegram.org");
      if (telegramMode === "unconfirmed") return Response.json({ ok: false });
      return Response.json({ ok: true, result: { message_id: 123 } });
    },
  }));
}
const call = (path, method = "GET", extra = {}) => runtime.dispatchFetch(`http://fixture.invalid${path}`, {
  method, headers: { Authorization: `Bearer ${token}` }, ...extra,
});
const cron = time => runtime.dispatchFetch(`http://fixture.invalid/__cron?time=${time}`);
const telegram = () => outbound.filter(item => item.method === "POST");

try {
  runtime = createRuntime();
  for (const [path, options] of [["/", {}], ["/probe?x=1", { method: "POST" }],
    ["/diagnostic", { method: "POST", body: "{}" }], ["/status", { headers: {} }]]) {
    assert.equal((await call(path, "GET", options)).status, 404);
  }
  assert.equal(outbound.length, 0);
  // Native runtime diagnostic follows the actual probe and durable notice paths.
  const diagnostic = await (await call("/diagnostic", "POST")).json();
  assert.equal(diagnostic.status, "completed");
  assert.equal(diagnostic.state.incident, false);
  assert.deepEqual(diagnostic.state.notices.map(n => n.delivery), ["confirmed", "confirmed"]);
  assert.equal(telegram().length, 2);
  assert.ok(telegram().every(n => n.body.text.startsWith("[DRILL] ")));
  assert.equal(outbound.filter(n => n.method === "GET").length, 0);
  // Restart the actual workerd process; persisted fixture cannot resend.
  await runtime.dispose();
  runtime = createRuntime();
  assert.equal((await (await call("/diagnostic", "POST")).json()).status, "already_consumed");
  assert.equal(telegram().length, 2);
  const untouched = await (await call("/status")).json();
  assert.equal(untouched.slot, -1);
  assert.equal(untouched.consumed, false);
  // Redirect cannot escape fixed production health URL. Parallel/redelivered Cron slots claim once.
  healthStatus = 302;
  await Promise.all([cron(scheduledTime), cron(scheduledTime)]);
  assert.equal(outbound.filter(n => n.method === "GET").length, 1);
  assert.equal((await (await call("/status")).json()).failures, 1);
  assert.equal((await cron(scheduledTime - 300_000)).status, 503);
  assert.equal((await cron(scheduledTime + 600_000)).status, 503);
  // Advance the stored observation through additional realistic five-minute slots in another
  // isolated object via diagnostic; never falsify the live clock or production URL.
  await runtime.dispose();
  telegramMode = "unconfirmed";
  runtime = createRuntime("true", "unconfirmed");
  const uncertain = await (await call("/diagnostic", "POST")).json();
  assert.deepEqual(uncertain.state.notices.map(n => n.delivery), ["unconfirmed", "unconfirmed"]);
  const count = telegram().length;
  await runtime.dispose();
  runtime = createRuntime("true", "unconfirmed");
  await call("/diagnostic", "POST");
  assert.equal(telegram().length, count);
  await runtime.dispose();
  runtime = createRuntime("false", "disabled");
  const disabled = await (await call("/diagnostic", "POST")).json();
  assert.deepEqual(disabled.state.notices.map(n => n.delivery), ["disabled", "disabled"]);
  assert.equal(telegram().length, count);
  console.log("workerd monitor passed: persistent isolated drill, two notifications, no ambiguous replay, auth, redirect refusal, Cron claim, default-disabled messages");
} finally {
  await runtime?.dispose();
  await rm(storage, { recursive: true, force: true });
}
