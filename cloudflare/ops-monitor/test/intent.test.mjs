import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState } from "../src/core.mjs";
import { MonitorState } from "../src/index.mjs";

test("crash after notification intent persists a consumed attempt; next invocation never retries", async () => {
  let stored;
  let calls = 0;
  const storage = {
    async put(_key, value) {
      stored = structuredClone(value);
      // Model the process dying immediately after durable intent succeeds.
      throw new Error("fixture process termination");
    },
  };
  const monitor = new MonitorState({ storage }, {});
  const state = initialState();
  state.notices = [{ kind: "outage", delivery: "pending" }];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error("must not send"); };
  try {
    await assert.rejects(() => monitor.deliver(state, false));
    assert.equal(stored.notices[0].delivery, "attempted");
    const restarted = new MonitorState({ storage }, {});
    await restarted.deliver(stored, false);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test("durable corruption returns sanitized failure without probe or resetting history", async () => {
  let writes = 0;
  const monitor = new MonitorState({
    blockConcurrencyWhile: callback => callback(),
    storage: { get: async () => ({ secret: "fixture-private" }), put: async () => { writes++; } },
  }, {});
  const response = await monitor.fetch(new Request("https://internal.invalid/probe", { method: "POST" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "inspection_required" });
  assert.equal(writes, 0);
});
