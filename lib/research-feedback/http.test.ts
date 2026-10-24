import { afterEach, expect, it, vi } from "vitest";
import { createRequesterFeedbackRoute } from "./http";
import { issueFeedbackToken } from "./service";
import { binding, secret, opinionFixture, recordedRun } from "./test-fixture";

const fixtures: ReturnType<typeof opinionFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
function fixture() {
  const f = opinionFixture(); fixtures.push(f); let run = recordedRun();
  const getQueryRun = vi.fn(async () => structuredClone(run));
  const db = vi.fn(async () => ({ getQueryRun })), store = vi.fn(() => f.store);
  const handler = createRequesterFeedbackRoute({ db, store, binding, secret: () => secret });
  const capability = issueFeedbackToken(run, binding, secret, f.store.storeId);
  const request = (body: unknown, token = capability.token) => handler(new Request(`${binding.origin}/api/research-feedback`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { ...f, db, store, getQueryRun, request, capability, changeOriginal() { run = { ...run, answer: "Changed durable answer" }; } };
}

it("keeps no response distinct, accepts one exact original-caller opinion and makes exact replay idempotent", async () => {
  const f = fixture();
  expect(await (await f.request({ operation: "read" })).json()).toMatchObject({ feedback: null, execution: "none" });
  const first = await f.request({ operation: "submit", choice: "revise", reason: "Need an example" });
  expect(first.status).toBe(200); expect(first.headers.get("cache-control")).toBe("private, no-store");
  const snapshot = await first.json(); expect(snapshot).toMatchObject({ feedback: { choice: "revise", reason: "Need an example", observations: { generationDurationMs: 1250 } }, execution: "none" });
  expect(await (await f.request({ operation: "submit", choice: "revise", reason: "Need an example" })).json()).toEqual(snapshot);
  expect((await f.request({ operation: "submit", choice: "useful" })).status).toBe(409);
  expect(await (await f.request({ operation: "read" })).json()).toEqual(snapshot);
  expect(JSON.stringify(snapshot)).not.toContain(f.capability.token);
});

it("rejects forged credentials before reading the original or opening metadata storage", async () => {
  const f = fixture();
  expect((await f.request({ operation: "submit", choice: "useful" }, f.capability.token + "tampered")).status).toBe(401);
  expect(f.db).not.toHaveBeenCalled(); expect(f.store).not.toHaveBeenCalled();
});

it("rejects changed originals and untrusted fields without any research or payment capability", async () => {
  const f = fixture();
  for (const extra of [{ runId: "another-run" }, { budget: 1 }, { wallet: `0x${"11".repeat(20)}` }, { refund: true }]) {
    expect((await f.request({ operation: "submit", choice: "useful", ...extra })).status).toBe(400);
  }
  expect(f.db).not.toHaveBeenCalled();
  f.changeOriginal(); expect((await f.request({ operation: "submit", choice: "useful" })).status).toBe(409);
});

it("bounds reason text and refuses a capability delivered from another journal", async () => {
  const f = fixture(), another = opinionFixture(); fixtures.push(another);
  expect((await f.request({ operation: "submit", choice: "useful", reason: "🧪".repeat(501) })).status).toBe(400);
  const other = issueFeedbackToken(recordedRun(), binding, secret, another.store.storeId);
  expect((await f.request({ operation: "submit", choice: "useful" }, other.token)).status).toBe(401);
  expect(f.db).not.toHaveBeenCalled();
});
