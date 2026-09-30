import assert from "node:assert/strict";
import { test } from "node:test";
import { advance, initialState, noticeText, notify, probe, validateState, HEALTH_URL } from "../src/core.mjs";

const now = Date.parse("2026-09-30T01:00:00Z");
const healthy = overrides => Response.json({ name: "keryx", ok: true, db: "ok", status: "operational",
  time: new Date(now).toISOString(), ...overrides });

test("three failures and two successes debounce; flapping resets; one notice per incident", () => {
  let state = initialState();
  for (const reason of ["http", "unreachable", "healthy", "http", "http"]) state = advance(state, reason, now);
  assert.equal(state.incident, false);
  state = advance(state, "http", now);
  assert.equal(state.incident, true);
  assert.deepEqual(state.notices, [{ kind: "outage", delivery: "pending" }]);
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
  assert.deepEqual(state.notices, [{ kind: "outage", delivery: "pending" }]);
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
  const env = { ALERT_TELEGRAM_BOT_TOKEN: "1:fixture", ALERT_TELEGRAM_CHAT_ID: "-123" };
  for (const [response, expected] of [
    [Response.json({ ok: true, result: { message_id: 123 } }), "confirmed"],
    [Response.json({ ok: false }), "unconfirmed"],
    [new Response(null, { status: 302 }), "unconfirmed"],
  ]) {
    let calls = 0;
    assert.equal(await notify(env, { kind: "outage" }, true, async (_url, options) => {
      calls++;
      assert.equal(options.redirect, "manual");
      const body = JSON.parse(options.body);
      assert.equal(body.chat_id, "-123");
      assert.equal(body.text, noticeText("outage", true));
      assert.match(body.text, /^\[DRILL\]/);
      return response;
    }), expected);
    assert.equal(calls, 1);
  }
});
