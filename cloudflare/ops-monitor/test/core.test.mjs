import assert from "node:assert/strict";
import { test } from "node:test";
import { advance, initialState, noticeText, notify, probe, probeUnavailable, validateState, HEALTH_URL, DRILL_UNAVAILABLE_URL } from "../src/core.mjs";

const now = Date.parse("2026-09-30T01:00:00Z");
const healthy = overrides => Response.json({ name: "keryx", ok: true, db: "ok", status: "operational",
  time: new Date(now).toISOString(), ...overrides });

test("three failures and two successes debounce; flapping resets; one notice per incident", () => {
  let state = initialState();
  for (const reason of ["http", "unreachable", "healthy", "http", "http"]) state = advance(state, reason, now);
  assert.equal(state.incident, false);
  state = advance(state, "http", now);
  assert.equal(state.incident, true);
  assert.equal(state.notices[0].id, "incident-1-outage");
  assert.equal(state.notices[0].delivery, "pending");
  for (let i = 0; i < 5; i++) state = advance(state, "http", now);
  assert.equal(state.notices.length, 1);
  state = advance(state, "healthy", now);
  state = advance(state, "degraded", now);
  state = advance(state, "healthy", now);
  assert.equal(state.incident, true);
  state = advance(state, "healthy", now);
  assert.equal(state.incident, false);
  assert.equal(state.notices.at(-1).kind, "recovery");
  state = advance(advance(advance(state, "http", now), "http", now), "http", now);
  assert.equal(state.notices.length, 1);
  assert.equal(state.notices[0].id, "incident-2-outage");
});

test("corrupted durable state fails closed", () => {
  for (const bad of [{}, { ...initialState(), failures: NaN }, { ...initialState(), notices: [{}] }]) {
    assert.throws(() => validateState(bad));
  }
});

test("strict health, freshness, bounded JSON and redirect refusal; no retry", async () => {
  const cases = [
    [() => healthy(), "healthy"], [() => healthy({ status: "degraded" }), "degraded"],
    [() => healthy({ db: "unreachable" }), "payload"], [() => healthy({ ok: false }), "payload"],
    [() => healthy({ name: "other" }), "payload"], [() => healthy({ time: "invalid" }), "stale"],
    [() => healthy({ time: new Date(now - 120_001).toISOString() }), "stale"],
    [() => healthy({ time: new Date(now + 60_001).toISOString() }), "stale"],
    [() => new Response(null, { status: 302, headers: { Location: "https://evil.invalid" } }), "http"],
    [() => new Response("failure", { status: 503 }), "http"],
    [() => new Response(" ".repeat(32_769)), "payload"],
    [() => new Response("not JSON"), "payload"],
    [() => { throw new TypeError("secret exception"); }, "unreachable"],
  ];
  for (const [fixture, expected] of cases) {
    let calls = 0;
    assert.equal(await probe(async (url, options) => {
      calls++;
      assert.equal(url, HEALTH_URL);
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "manual");
      assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Cache-Control"]);
      return fixture();
    }, now), expected);
    assert.equal(calls, 1);
  }
});

test("Telegram result requires positive acknowledgement; static text cannot leak payload", async () => {
  const env = { ALERT_TELEGRAM_BOT_TOKEN: "1:fixture", ALERT_TELEGRAM_CHAT_ID: "-123", DIAGNOSTIC_RUN_ID: "unit" };
  for (const [response, expected] of [
    [Response.json({ ok: true, result: { message_id: 123, chat: { id: -123 } } }), "confirmed"],
    [Response.json({ ok: true, result: { message_id: 123, chat: { id: -456 } } }), "unconfirmed"],
    [Response.json({ ok: true, result: { message_id: 0, chat: { id: -123 } } }), "unconfirmed"],
    [Response.json({ ok: true, result: { message_id: 123 } }), "unconfirmed"],
    [Response.json({ ok: false }), "unconfirmed"],
    [new Response(null, { status: 302 }), "unconfirmed"],
  ]) {
    let calls = 0;
    const notice = { kind: "outage", id: "incident-1-outage" };
    assert.equal(await notify(env, notice, true, async (_url, options) => {
      calls++;
      assert.equal(options.redirect, "manual");
      const body = JSON.parse(options.body);
      assert.equal(body.chat_id, "-123");
      assert.equal(body.text, noticeText(notice, true, "unit"));
      assert.match(body.text, /^\[DRILL\]/);
      return response;
    }), expected);
    assert.equal(calls, 1);
  }
});

test("drill uses only fixed unavailable route, refuses redirects and requires exact 404", async () => {
  for (const [status, expected] of [[404, "http"], [503, "payload"], [302, "payload"], [200, "payload"]]) {
    let calls = 0;
    assert.equal(await probeUnavailable(async (url, options) => {
      calls++;
      assert.equal(url, DRILL_UNAVAILABLE_URL);
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, "manual");
      return new Response(null, { status });
    }, now), expected);
    assert.equal(calls, 1);
  }
});

const openingLabels = new Map([
  ["unreachable", "request timeout or transport failure"],
  ["http", "HTTP error or refused redirect"],
  ["payload", "invalid or oversized health response"],
  ["degraded", "degraded service status (HTTP 200)"],
  ["stale", "invalid, old or future health timestamp"],
]);

for (const [reason, label] of openingLabels) {
  test(`incident snapshots the opening ${reason} check across later failure and recovery`, () => {
    const previous = advance(advance(initialState(), "http", now), "unreachable", now);
    const before = structuredClone(previous);
    let state = advance(previous, reason, now);
    assert.equal(state.version, 3);
    assert.equal(state.notices[0].reason, reason);
    assert.deepEqual(previous, before);
    const opening = structuredClone(state.notices[0]);
    const text = noticeText(opening, false);
    assert.ok(text.includes(`Opening check: ${label}.`));
    assert.ok(text.length < 600);
    for (const next of ["stale", "http", "healthy", "degraded", "healthy", "healthy"]) state = advance(state, next, now);
    assert.equal(state.reason, "healthy");
    assert.deepEqual(state.notices[0], opening);
    assert.equal(state.notices[1].reason, "healthy");
    assert.equal(noticeText(state.notices[0], false), text);
    assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
  });
}

function legacyState(delivery = "attempted") {
  const attempts = ["pending", "disabled"].includes(delivery) ? 0 : delivery === "confirmed" ? 1 : 2;
  return { version: 2, slot: 1234, failures: 0, successes: 2, incident: false, incidentSequence: 87,
    reason: "healthy", checkedAt: now, consumed: true,
    notices: ["outage", "recovery"].map(kind => ({ kind, id: `incident-87-${kind}`, delivery, attempts,
      nextAttemptAt: attempts ? now + 300_000 : null })) };
}

for (const delivery of ["pending", "attempted", "confirmed", "unconfirmed", "disabled"]) {
  test(`legacy ${delivery} journals normalize without resetting or inventing an opening reason`, () => {
    const legacy = legacyState(delivery), before = structuredClone(legacy);
    const normalized = validateState(legacy);
    assert.deepEqual(legacy, before);
    assert.deepEqual(normalized, { ...before, version: 3,
      notices: before.notices.map(notice => ({ ...notice, reason: null })) });
    assert.deepEqual(validateState(JSON.parse(JSON.stringify(normalized))), normalized);
    assert.equal(noticeText(normalized.notices[0], false),
      "Keryx health incident: three consecutive failed checks. Inspect https://keryx.cc/status and the incident runbook. No payment or job action was taken. Notice incident-87-outage. Delivery may repeat when an acknowledgement is lost (maximum three attempts).");
  });
}

test("advancing a legacy active incident preserves its old pending notice and completes the same recovery", () => {
  const legacy = legacyState();
  legacy.incident = true; legacy.failures = 3; legacy.successes = 0; legacy.reason = "http";
  legacy.notices.pop();
  let state = advance(legacy, "healthy", now);
  assert.equal(state.version, 3);
  assert.equal(state.incident, true);
  assert.deepEqual(state.notices, legacy.notices.map(notice => ({ ...notice, reason: null })));
  state = advance(state, "healthy", now);
  assert.equal(state.incident, false);
  assert.equal(state.incidentSequence, 87);
  assert.equal(state.notices[1].id, "incident-87-recovery");
  assert.equal(state.notices[1].reason, "healthy");
  assert.equal(state.slot, legacy.slot);
  assert.equal(state.consumed, legacy.consumed);
});

test("both state formats refuse malformed or unreviewed notice context", () => {
  const legacy = legacyState(), current = validateState(legacy);
  const bad = [
    { ...legacy, extra: "fixture-private" }, { ...legacy, version: 1 }, { ...legacy, version: 4 },
    { ...legacy, notices: legacy.notices.map(n => ({ ...n, reason: "http" })) },
    { ...legacy, notices: [{ ...legacy.notices[0], attempts: 4 }] },
    { ...legacy, notices: [{ ...legacy.notices[0], id: "incident-86-outage" }] },
    { ...current, notices: [{ ...current.notices[0], reason: "healthy" }] },
    { ...current, notices: [{ ...current.notices[1], reason: "http" }] },
    { ...current, notices: [{ ...current.notices[0], reason: "fixture-private" }] },
    { ...current, notices: [{ ...current.notices[0], reason: { raw: "fixture-private" } }] },
    { ...current, notices: [{ ...current.notices[0], reason: undefined }] },
    { ...current, notices: [{ ...current.notices[0], rawHealth: "fixture-private" }] },
  ];
  for (const state of bad) assert.throws(() => validateState(state), /Monitor state invalid/);
});

test("notice rendering uses static reason labels and preserves the recovery limitation", () => {
  const text = noticeText({ kind: "outage", id: "incident-1-outage", reason: "fixture-private", rawHealth: "fixture-private" }, false);
  assert.ok(!text.includes("fixture-private"));
  assert.ok(!text.includes("Opening check:"));
  const state = ["http", "http", "degraded", "healthy", "healthy"].reduce((s, reason) => advance(s, reason, now), initialState());
  assert.equal(noticeText(state.notices[1], false),
    "Keryx health recovered: two consecutive healthy checks. This confirms endpoint readiness only; review outstanding incidents separately. Notice incident-1-recovery. Delivery may repeat when an acknowledgement is lost (maximum three attempts).");
});
