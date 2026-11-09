import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const bundle = await readFile(new URL(".wrangler/build/index.js", import.meta.url), "utf8");
const token = "x".repeat(43);
const storage = await mkdtemp(join(tmpdir(), "keryx-monitor-"));
const outbound = [];
let healthStatus = 200;
let unavailableStatus = 404;
let telegramMode = "confirmed";
let runtime;

function createRuntime(notifications = "true", runId = "runtime-acceptance") {
  return new Miniflare(convertV4MiniflareOptions({
    name: "keryx-ops-monitor", compatibilityDate: "2026-09-30", resourcePersistencePath: storage,
    modules: [
      { type: "ESModule", path: "harness.mjs", contents: `
        import worker, { MonitorState } from './worker.mjs';
        export class RuntimeMonitorState extends MonitorState {
          async fetch(request) {
            if(new URL(request.url).pathname === '/__testLegacy') {
              await this.state.storage.put('state',await request.json());
              return Response.json({status:'fixture_seeded'});
            }
            if(new URL(request.url).pathname === '/__testStored') {
              return Response.json(await this.state.storage.get('state'));
            }
            if(new URL(request.url).pathname === '/__testDue') {
              const state = await this.state.storage.get('state');
              for(const notice of state.notices) notice.nextAttemptAt = Date.now()-1;
              await this.state.storage.put('state',state);
              return Response.json({status:'fixture_due'});
            }
            return super.fetch(request);
          }
        }
        export default { async fetch(request, env) {
          const url = new URL(request.url);
          if(url.pathname === '/__cron') {
            try { await worker.scheduled({scheduledTime:Number(url.searchParams.get('time'))}, env);
              return Response.json({status:'completed'}); }
            catch { return Response.json({status:'failed'}, {status:503}); }
          }
          if(['/__due','/__legacy','/__stored'].includes(url.pathname)) {
            const stub=env.MONITOR.get(env.MONITOR.idFromName('diagnostic-'+env.DIAGNOSTIC_RUN_ID));
            const path={'/__due':'/__testDue','/__legacy':'/__testLegacy','/__stored':'/__testStored'}[url.pathname];
            return stub.fetch('https://internal.invalid'+path, url.pathname === '/__legacy'
              ? {method:'POST',body:await request.text()} : {});
          }
          return worker.fetch(request,env);
        }};` },
      { type: "ESModule", path: "worker.mjs", contents: bundle },
    ],
    durableObjects: { MONITOR: { className: "RuntimeMonitorState", useSQLite: true } },
    bindings: { MONITOR_DIAGNOSTIC_TOKEN: token, ALERT_TELEGRAM_BOT_TOKEN: `123:${"x".repeat(30)}`,
      ALERT_TELEGRAM_CHAT_ID: "-123", DIAGNOSTIC_RUN_ID: runId,
      DIAGNOSTIC_NOTIFICATIONS_ENABLED: notifications },
    outboundService: async request => {
      const url = new URL(request.url);
      outbound.push({ url: request.url, method: request.method, body: request.method === "POST" ? await request.json() : null });
      if (url.hostname === "keryx.cc") {
        assert.equal(request.headers.get("authorization"), null);
        assert.equal(request.method, "GET");
        if(request.url === "https://keryx.cc/api/keryx-ops-monitor-drill-unavailable") return new Response(null, {status:unavailableStatus});
        assert.equal(request.url, "https://keryx.cc/api/health");
        return healthStatus === 200
          ? Response.json({ name: "keryx", ok: true, db: "ok", status: "operational", time: new Date().toISOString() })
          : new Response(null, { status: healthStatus,
            ...(healthStatus === 302 ? { headers: { Location: "https://evil.invalid" } } : {}) });
      }
      assert.equal(url.hostname, "api.telegram.org");
      if (telegramMode === "unconfirmed") return Response.json({ ok: false });
      return Response.json({ ok: true, result: { message_id: 123, chat: { id: -123 } } });
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
  assert.equal(diagnostic.control, "healthy");
  assert.equal(diagnostic.state.incident, false);
  assert.deepEqual(diagnostic.state.notices.map(n => n.delivery), ["confirmed", "confirmed"]);
  assert.equal(diagnostic.state.version, 3);
  assert.deepEqual(diagnostic.state.notices.map(n => n.reason), ["http", "healthy"]);
  assert.equal(telegram().length, 2);
  assert.ok(telegram().every(n => n.body.text.startsWith("[DRILL] ")));
  assert.match(telegram()[0].body.text, /Opening check: HTTP error or refused redirect/);
  assert.ok(!telegram()[1].body.text.includes("Opening check:"));
  assert.deepEqual(outbound.filter(n => n.method === "GET").map(n => n.url), [
    "https://keryx.cc/api/health",
    ...Array(3).fill("https://keryx.cc/api/keryx-ops-monitor-drill-unavailable"),
    "https://keryx.cc/api/health", "https://keryx.cc/api/health",
  ]);
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
  // Capture just before dispatch: a module-load slot boundary can become stale during setup.
  const scheduledTime = Date.now();
  const cronResponses = await Promise.all([cron(scheduledTime), cron(scheduledTime)]);
  assert.deepEqual(cronResponses.map(response => response.status), [200, 200]);
  assert.equal(outbound.filter(n => n.method === "GET").length, 7);
  assert.equal((await (await call("/status")).json()).failures, 1);
  assert.equal((await cron(scheduledTime - 300_000)).status, 503);
  assert.equal((await cron(scheduledTime + 600_000)).status, 503);
  // Advance the stored observation through additional realistic five-minute slots in another
  // isolated object via diagnostic; never falsify the live clock or production URL.
  await runtime.dispose();
  healthStatus = 200;
  telegramMode = "unconfirmed";
  runtime = createRuntime("true", "unconfirmed");
  const uncertain = await (await call("/diagnostic", "POST")).json();
  assert.deepEqual(uncertain.state.notices.map(n => n.delivery), ["unconfirmed", "unconfirmed"]);
  const countBeforeRetries = telegram().length;
  await runtime.dispose();
  runtime = createRuntime("true", "unconfirmed");
  await call("/diagnostic", "POST");
  assert.equal(telegram().length, countBeforeRetries);
  for(let step=0;step<5;step++) {
    await call("/__due"); // Test-only durable deadline adjustment; no production option.
    await call("/diagnostic", "POST");
    await runtime.dispose();
    runtime = createRuntime("true", "unconfirmed");
  }
  assert.equal(telegram().length, countBeforeRetries+4); // Two records, max three attempts each.
  const retried = telegram().slice(countBeforeRetries - 2);
  for (const kind of ["outage", "recovery"]) {
    const messages = retried.filter(n => n.body.text.includes(`Notice incident-1-${kind}.`));
    assert.equal(messages.length, 3);
    assert.equal(new Set(messages.map(n => n.body.text)).size, 1);
  }
  const count = telegram().length;
  await runtime.dispose();
  runtime = createRuntime("false", "disabled");
  const disabled = await (await call("/diagnostic", "POST")).json();
  assert.deepEqual(disabled.state.notices.map(n => n.delivery), ["disabled", "disabled"]);
  assert.equal(telegram().length, count);
  await runtime.dispose();
  runtime = createRuntime("true", "wrong-fixture");
  unavailableStatus = 503;
  const wrongFixture = await (await call("/diagnostic", "POST")).json();
  assert.equal(wrongFixture.status, "fixture_failed");
  assert.equal(wrongFixture.step, 0);
  assert.equal(wrongFixture.state.notices.length, 0);
  assert.equal(telegram().length, count);
  await runtime.dispose();
  unavailableStatus = 404;
  healthStatus = 503;
  runtime = createRuntime("true", "failed-control");
  const failedControl = await (await call("/diagnostic", "POST")).json();
  assert.equal(failedControl.status, "control_failed");
  assert.equal(failedControl.state.notices.length, 0);
  const requestsAfterControl = outbound.length;
  healthStatus = 200;
  assert.equal((await (await call("/diagnostic", "POST")).json()).status, "already_consumed");
  assert.equal(outbound.length, requestsAfterControl);
  assert.equal(telegram().length, count);
  // Seed a version2 journal only through this virtual harness, never the Worker.
  // Dispose/reopen actual SQLite-backed workerd before and after normalization.
  await runtime.dispose();
  runtime = createRuntime("true", "legacy");
  const legacy = { version: 2, slot: 1234, failures: 0, successes: 2, incident: false, incidentSequence: 87,
    reason: "healthy", checkedAt: Date.now(), consumed: true,
    notices: [
      { kind: "outage", id: "incident-87-outage", delivery: "attempted", attempts: 2, nextAttemptAt: Date.now() + 300_000 },
      { kind: "recovery", id: "incident-87-recovery", delivery: "confirmed", attempts: 1, nextAttemptAt: Date.now() + 300_000 },
    ] };
  assert.equal((await (await call("/__legacy", "POST", { body: JSON.stringify(legacy) })).json()).status, "fixture_seeded");
  await runtime.dispose(); runtime = createRuntime("true", "legacy");
  const beforeLegacy = outbound.length;
  const migratedRead = await (await call("/diagnostic", "POST")).json();
  assert.equal(migratedRead.status, "already_consumed");
  assert.deepEqual(migratedRead.state, { ...legacy, version: 3, notices: legacy.notices.map(n => ({ ...n, reason: null })) });
  assert.equal(outbound.length, beforeLegacy);
  assert.deepEqual(await (await call("/__stored")).json(), legacy); // Read did not write migration or reset retries.
  await call("/__due"); // Existing test-only deadline fixture, never a production operation.
  const dueLegacy = await (await call("/__stored")).json();
  assert.equal(dueLegacy.version, 2);
  await runtime.dispose(); runtime = createRuntime("true", "legacy");
  telegramMode = "confirmed";
  const deliveryStarted = Date.now();
  const deliveredLegacy = await (await call("/diagnostic", "POST")).json();
  const deliveryEnded = Date.now();
  const nextAttemptAt = deliveredLegacy.state.notices[0].nextAttemptAt;
  assert.ok(nextAttemptAt >= deliveryStarted + 300_000 - 1000 && nextAttemptAt <= deliveryEnded + 300_000 + 1000);
  const expectedLegacy = { ...dueLegacy, version: 3, notices: dueLegacy.notices.map(n => ({ ...n, reason: null })) };
  expectedLegacy.notices[0] = { ...dueLegacy.notices[0], reason: null, delivery: "confirmed", attempts: 3, nextAttemptAt };
  assert.deepEqual(deliveredLegacy.state, expectedLegacy);
  assert.ok(deliveredLegacy.state.notices[0].nextAttemptAt > dueLegacy.notices[0].nextAttemptAt);
  assert.equal(outbound.length, beforeLegacy + 1);
  assert.equal(telegram().length, count + 1);
  assert.equal(telegram().at(-1).body.text,
    "[DRILL] legacy Keryx health incident: three consecutive failed checks. Inspect https://keryx.cc/status and the incident runbook. No payment or job action was taken. Notice incident-87-outage. Delivery may repeat when an acknowledgement is lost (maximum three attempts).");
  assert.deepEqual(await (await call("/__stored")).json(), deliveredLegacy.state);
  await runtime.dispose(); runtime = createRuntime("true", "legacy");
  await call("/diagnostic", "POST");
  assert.equal(outbound.length, beforeLegacy + 1);
  console.log("workerd notice reason passed: persisted opening class, stable retry text after recovery, strict legacy migration and unchanged pending text, counters, consumed state and terminal suppression across native restarts");
  console.log("workerd monitor passed: fixed external drill protocol, durable bounded retries across restart, confirmed suppression, auth, redirect refusal, Cron claim, default-disabled messages");
} finally {
  await runtime?.dispose();
  assert.equal(dirname(resolve(storage)), resolve(tmpdir()));
  assert.ok(basename(storage).startsWith("keryx-monitor-"));
  await rm(storage, { recursive: true, force: true });
}
