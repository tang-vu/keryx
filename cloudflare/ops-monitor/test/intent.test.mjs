import assert from "node:assert/strict";
import { test } from "node:test";
import { advance, initialState, SLOT_MS } from "../src/core.mjs";
import worker, { MonitorState } from "../src/index.mjs";

function incident() {
  return ["http", "http", "http"].reduce((state, reason) => advance(state, reason, Date.now()), initialState());
}
const env = { ALERT_TELEGRAM_BOT_TOKEN: "1:fixture", ALERT_TELEGRAM_CHAT_ID: "-123" };
const acknowledgement = () => Response.json({ ok: true, result: { message_id: 123, chat: { id: -123 } } });

test("crash before fetch persists attempt; restart retries only after five minutes, then confirms", async () => {
  let stored;
  let calls = 0;
  const originalNow = Date.now;
  const previousFetch = globalThis.fetch;
  let now = originalNow();
  Date.now = () => now;
  const storage = { async put(_key, value) { stored = structuredClone(value); } };
  const failingStorage = { async put(_key, value) {
    await storage.put(_key, value);
    throw new Error("fixture crash after durable attempt, before network");
  } };
  globalThis.fetch = async () => { calls++; return acknowledgement(); };
  try {
    await assert.rejects(() => new MonitorState({ storage: failingStorage }, env).deliver(incident(), false));
    assert.equal(stored.notices[0].attempts, 1);
    assert.equal(stored.notices[0].delivery, "attempted");
    const restarted = new MonitorState({ storage }, env);
    await restarted.deliver(stored, false);
    assert.equal(calls, 0);
    now += SLOT_MS - 1;
    await restarted.deliver(stored, false);
    assert.equal(calls, 0);
    now++;
    await restarted.deliver(stored, false);
    assert.equal(calls, 1);
    assert.equal(stored.notices[0].delivery, "confirmed");
    assert.equal(stored.notices[0].attempts, 2);
    now += SLOT_MS * 20;
    await new MonitorState({ storage }, env).deliver(stored, false);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previousFetch; Date.now = originalNow; }
});

test("lost ACK may duplicate stable notice; durable count limits attempts to three across restarts", async () => {
  const originalNow = Date.now;
  const previousFetch = globalThis.fetch;
  let now = originalNow();
  Date.now = () => now;
  let stored = incident();
  const seen = [];
  const storage = { async put(_key, value) { stored = structuredClone(value); } };
  globalThis.fetch = async (_url, options) => {
    seen.push(JSON.parse(options.body).text);
    throw new TypeError("fixture acknowledgement lost");
  };
  try {
    for (let i = 0; i < 8; i++) {
      await new MonitorState({ storage }, env).deliver(stored, false);
      await new MonitorState({ storage }, env).deliver(stored, false);
      now += SLOT_MS;
    }
    assert.equal(seen.length, 3);
    assert.equal(new Set(seen).size, 1);
    assert.match(seen[0], /Notice incident-1-outage/);
    assert.equal(stored.notices[0].attempts, 3);
    assert.equal(stored.notices[0].delivery, "unconfirmed");
  } finally { globalThis.fetch = previousFetch; Date.now = originalNow; }
});

test("positive remote ACK followed by storage failure remains attempted; next attempt is delayed", async () => {
  let stored;
  let writes = 0;
  let calls = 0;
  const originalNow = Date.now;
  const previousFetch = globalThis.fetch;
  let now = originalNow();
  Date.now = () => now;
  const crashStorage = { async put(_key, value) {
    writes++;
    if (writes === 2) throw new Error("fixture crash before durable confirmation");
    stored = structuredClone(value);
  } };
  globalThis.fetch = async () => { calls++; return acknowledgement(); };
  try {
    await assert.rejects(() => new MonitorState({ storage: crashStorage }, env).deliver(incident(), false));
    assert.equal(calls, 1);
    assert.equal(stored.notices[0].delivery, "attempted");
    const storage = { async put(_key, value) { stored = structuredClone(value); } };
    await new MonitorState({ storage }, env).deliver(stored, false);
    assert.equal(calls, 1);
    now += SLOT_MS;
    await new MonitorState({ storage }, env).deliver(stored, false);
    assert.equal(calls, 2);
    assert.equal(stored.notices[0].delivery, "confirmed");
  } finally { globalThis.fetch = previousFetch; Date.now = originalNow; }
});

test("provider refusal is bounded and confirmed acknowledgement never repeats", async () => {
  const originalNow = Date.now;
  const previousFetch = globalThis.fetch;
  let now = originalNow();
  Date.now = () => now;
  let stored = incident();
  let calls = 0;
  const storage = { async put(_key, value) { stored = structuredClone(value); } };
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 403 }); };
  try {
    for (let i = 0; i < 5; i++) {
      await new MonitorState({ storage }, env).deliver(stored, false);
      now += SLOT_MS;
    }
    assert.equal(calls, 3);
    stored = incident();
    globalThis.fetch = async () => { calls++; return acknowledgement(); };
    for (let i = 0; i < 5; i++) {
      await new MonitorState({ storage }, env).deliver(stored, false);
      now += SLOT_MS;
    }
    assert.equal(calls, 4);
  } finally { globalThis.fetch = previousFetch; Date.now = originalNow; }
});

test("durable corruption returns sanitized failure without probe or resetting history", async () => {
  let writes = 0;
  const monitor = new MonitorState({
    storage: { get: async () => ({ secret: "fixture-private" }), put: async () => { writes++; } },
  }, {});
  const response = await monitor.fetch(new Request("https://internal.invalid/probe", { method: "POST" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "inspection_required" });
  assert.equal(writes, 0);
});

test("authenticated stalled request body is rejected within five seconds before DO admission", async () => {
  let calls = 0;
  const config = { ...env, ALERT_TELEGRAM_BOT_TOKEN: `123:${"x".repeat(30)}`,
    MONITOR_DIAGNOSTIC_TOKEN: "x".repeat(43), DIAGNOSTIC_RUN_ID: "body-test",
    DIAGNOSTIC_NOTIFICATIONS_ENABLED: "false", MONITOR: { get() { calls++; } } };
  const request = new Request("https://fixture.invalid/diagnostic", { method: "POST",
    headers: { Authorization: `Bearer ${config.MONITOR_DIAGNOSTIC_TOKEN}` },
    body: new ReadableStream({}), duplex: "half" });
  const started = Date.now();
  const response = await worker.fetch(request, config);
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
  assert.ok(Date.now() - started >= 4_900 && Date.now() - started < 8_000);
});

test("legacy status is read-only and the next claimed probe persists migration before outbound I/O", async () => {
  const originalNow = Date.now, previousFetch = globalThis.fetch;
  const now = originalNow(), slot = Math.floor(now / SLOT_MS);
  Date.now = () => now;
  let stored = { version: 2, slot: slot - 1, failures: 3, successes: 0, incident: true, incidentSequence: 87,
    reason: "http", checkedAt: now - SLOT_MS, consumed: true,
    notices: [{ kind: "outage", id: "incident-87-outage", delivery: "attempted", attempts: 2, nextAttemptAt: now + SLOT_MS }] };
  const original = structuredClone(stored), writes = [], requests = [];
  const storage = { get: async () => structuredClone(stored), put: async (_key, state) => {
    stored = structuredClone(state); writes.push(structuredClone(state));
  } };
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(options.method, "GET");
    assert.equal(url, "https://keryx.cc/api/health");
    assert.equal(writes.length, 1);
    assert.equal(stored.version, 3);
    assert.equal(stored.slot, slot);
    assert.deepEqual(stored.notices, original.notices.map(notice => ({ ...notice, reason: null })));
    return Response.json({ name: "keryx", ok: true, db: "ok", status: "operational", time: new Date(now).toISOString() });
  };
  try {
    const status = await new MonitorState({ storage }, env).fetch(new Request("https://internal.invalid/status"));
    assert.equal((await status.json()).version, 3);
    assert.deepEqual(stored, original);
    assert.equal(writes.length, 0);
    assert.equal(requests.length, 0);
    const request = () => new Request("https://internal.invalid/probe", { method: "POST" });
    const response = await new MonitorState({ storage }, env).fetch(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "completed");
    assert.equal(stored.incident, true);
    assert.equal(stored.successes, 1);
    assert.equal(stored.consumed, true);
    assert.equal(stored.notices[0].attempts, 2);
    assert.equal(stored.notices[0].nextAttemptAt, original.notices[0].nextAttemptAt);
    const beforeDuplicate = structuredClone(stored), writeCount = writes.length;
    assert.equal((await (await new MonitorState({ storage }, env).fetch(request())).json()).status, "already_claimed");
    assert.deepEqual(stored, beforeDuplicate);
    assert.equal(writes.length, writeCount);
    assert.equal(requests.length, 1);
  } finally { Date.now = originalNow; globalThis.fetch = previousFetch; }
});

test("a pending outage retries its persisted opening reason after readiness has recovered", async () => {
  const originalNow = Date.now, previousFetch = globalThis.fetch;
  let now = originalNow(); Date.now = () => now;
  let stored = ["http", "http", "degraded"].reduce((s, reason) => advance(s, reason, now), initialState());
  const storage = { put: async (_key, value) => { stored = structuredClone(value); } };
  const messages = [];
  globalThis.fetch = async (_url, options) => {
    messages.push(JSON.parse(options.body).text);
    if (messages.length === 1) throw new Error("fixture lost ACK");
    return acknowledgement();
  };
  try {
    await new MonitorState({ storage }, env).deliver(stored, false);
    assert.equal(stored.notices[0].attempts, 1);
    stored = advance(advance(stored, "healthy", now), "healthy", now);
    await new MonitorState({ storage }, env).deliver(stored, false);
    assert.equal(stored.reason, "healthy");
    assert.equal(messages.length, 2);
    assert.match(messages[1], /health recovered/);
    now += SLOT_MS;
    await new MonitorState({ storage }, env).deliver(JSON.parse(JSON.stringify(stored)), false);
    assert.equal(messages.length, 3);
    assert.equal(messages[0], messages[2]);
    assert.match(messages[2], /Opening check: degraded service status \(HTTP 200\)/);
    assert.equal(stored.notices[0].reason, "degraded");
    assert.equal(stored.notices[0].attempts, 2);
    assert.equal(stored.notices[0].delivery, "confirmed");
    assert.equal(stored.notices[1].delivery, "confirmed");
  } finally { Date.now = originalNow; globalThis.fetch = previousFetch; }
});
