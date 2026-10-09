import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { KeryxDB } from "../db/keryx-db";
import { createSqliteDecisionReviews } from "../db/decision-reviews-sqlite";
import { createDecisionReviewRoutes } from "./decision-review-routes";
import type { CaptureDecision } from "./decision-review-types";
const wallet = `0x${"1".repeat(40)}`, other = `0x${"2".repeat(40)}`, hash = "a".repeat(64), runId = randomUUID();
const connections: DatabaseSync[] = [];
afterEach(() => { for (const db of connections.splice(0)) db.close(); });
function fixture() {
  const db = new DatabaseSync(":memory:"); connections.push(db); const store = createSqliteDecisionReviews(db);
  const session = vi.fn(async () => ({ db: { decisionReviews: store } as KeryxDB, wallet, currentId: hash }));
  return { store, session, routes: createDecisionReviewRoutes(session, "https://keryx.cc") };
}
const input: CaptureDecision = { policyVersion: "captured-owner-decisions-v1", engine: "synthetic", requestedModel: null, runId, round: 0, ordinal: 0,
  sourceName: "PRIVATE source", modelAction: "BUY", codeAction: "BUY", codeRule: "selected", reviewFirst: false, cohort: "unknown", cohortEvidence: null,
  terms: { assetId: "asset", sourceId: "source", owned: true, network: "eip155:5042002", payTo: wallet, priceMicroUsdc: "1", listPriceMicroUsdc: "1", citationBudgetMicroUsdc: "5" } };
function request(body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://keryx.cc/api/me/decision-reviews${body === undefined ? `?runId=${runId}` : ""}`, {
    method: body === undefined ? "GET" : "POST", headers: { "X-Keryx-Expected-Wallet": wallet, ...(body === undefined ? {} : { Origin: "https://keryx.cc", "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe("owner-only review routes", () => {
  it("returns only current authenticated owner rows with cache/identity variation", async () => {
    const f = fixture(); await f.store.capture(wallet, input); await f.store.capture(other, { ...input, sourceName: "OTHER private" });
    const response = await f.routes.GET(request()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reviews: [{ sourceName: "PRIVATE source" }] });
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie, X-Keryx-Expected-Wallet");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("refuses missing identity precondition, arbitrary owner URL and changed owner", async () => {
    const f = fixture(); const missing = request(); missing.headers.delete("x-keryx-expected-wallet");
    expect((await f.routes.GET(missing)).status).toBe(428); expect(f.session).not.toHaveBeenCalled();
    expect((await f.routes.GET(new Request(`${request().url}&wallet=${other}`, { headers: request().headers }))).status).toBe(400);
    expect((await f.routes.GET(request(undefined, { "X-Keryx-Expected-Wallet": other }))).status).toBe(409);
  });
  it("refuses bearer access and foreign configured origin before session/storage", async () => {
    const f = fixture(); expect((await f.routes.GET(request(undefined, { Authorization: "Bearer synthetic" }))).status).toBe(401);
    expect((await f.routes.POST(request({}, { Origin: "https://foreign.example", Host: "keryx.cc", "X-Forwarded-Host": "keryx.cc" }))).status).toBe(403);
    expect(f.session).not.toHaveBeenCalled();
  });
  it("allows a private post-settled opinion without financial or continuation authority", async () => {
    const f = fixture(), record = await f.store.capture(wallet, input);
    const response = await f.routes.POST(request({ id: record.id, key: randomUUID(), context: "opinion", expectedCode: { action: "BUY", rule: "selected" }, value: "disagree", reason: "private review" }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ review: { state: "observed", verdict: { value: "disagree", reason: "private review" } } });
  });
  it("refuses a stored held gate without the original live browser and closed/oversize bodies", async () => {
    const f = fixture(), record = await f.store.capture(wallet, { ...input, reviewFirst: true }); await f.store.begin(wallet, record.id);
    expect((await f.routes.POST(request({ id: record.id, key: randomUUID(), context: "gate", value: "agree" }))).status).toBe(409);
    expect((await f.routes.POST(request({ id: record.id, key: randomUUID(), context: "opinion", value: "agree", extra: true }))).status).toBe(400);
    expect((await f.routes.POST(request({ reason: "x".repeat(5000) }))).status).toBe(400);
    expect((await f.store.read(wallet, record.id))?.state).toBe("held");
  });
  it("preserves missing or sealed ordinary capability as unavailable", async () => {
    const routes = createDecisionReviewRoutes(async () => ({ db: {} as KeryxDB, wallet, currentId: hash }), "https://keryx.cc");
    const response = await routes.GET(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "review_unavailable" });
  });
  it("owner readback expires an elapsed crash remnant and permits only a later nonfinancial opinion", async () => {
    const f = fixture(), before = Date.now() - 120000, record = await f.store.capture(wallet, { ...input, reviewFirst: true }, before);
    await f.store.begin(wallet, record.id, before);
    const readback = await f.routes.GET(request()); expect(readback.status).toBe(200);
    expect(await readback.json()).toMatchObject({ reviews: [{ state: "expired", initialCodeAction: "BUY", codeAction: "BUY" }] });
    expect((await f.routes.POST(request({ id: record.id, key: randomUUID(), context: "gate", value: "agree" }))).status).toBe(409);
    const opinion = await f.routes.POST(request({ id: record.id, key: randomUUID(), context: "opinion", expectedCode: { action: "BUY", rule: "selected" }, value: "disagree" }));
    expect(opinion.status).toBe(200); expect(await opinion.json()).toMatchObject({ review: { state: "expired", verdict: { context: "opinion" } } });
  });
});
