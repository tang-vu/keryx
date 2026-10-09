import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createSqliteDecisionReviews } from "./decision-reviews-sqlite";
import { REVIEW_WAIT_MS, decisionReviewMetricsSchema, reviewMicros, type CaptureDecision, type DecisionReviewsStore } from "../research/decision-review-types";
const owner = `0x${"1".repeat(40)}`, other = `0x${"2".repeat(40)}`;
const at = Date.parse("2026-10-09T10:00:00.000Z");
const connections: DatabaseSync[] = [];
afterEach(() => { for (const db of connections.splice(0)) db.close(); });
function fixture() { const db = new DatabaseSync(":memory:"); connections.push(db); return { db, store: createSqliteDecisionReviews(db) }; }
function decision(patch: Partial<CaptureDecision> = {}): CaptureDecision {
  return { policyVersion: "captured-owner-decisions-v1", engine: "synthetic", requestedModel: null,
    runId: randomUUID(), round: 0, ordinal: 0, sourceName: "Synthetic source", modelAction: "BUY", codeAction: "BUY", codeRule: "selected",
    reviewFirst: true, cohort: "unknown", cohortEvidence: null,
    terms: { assetId: "item:one", sourceId: "source-one", owned: true, itemId: "one", contentVersion: "exact-version-one",
      network: "eip155:5042002", payTo: other, priceMicroUsdc: "5000", listPriceMicroUsdc: "5000", citationBudgetMicroUsdc: "10000" }, ...patch };
}
async function held(store: DecisionReviewsStore) { const record = await store.capture(owner, decision(), at); return store.begin(owner, record.id, at); }
describe("ordinary decision reviews", () => {
  it("atomically refuses an opinion for a stale displayed code snapshot while exact-key readback survives later change", async () => {
    const { db, store } = fixture(), record = await store.capture(owner, decision({ reviewFirst: false }), at);
    const intent = { id: record.id, key: randomUUID(), context: "opinion" as const, value: "agree" as const, expectedCode: { action: "BUY" as const, rule: "selected" as const } };
    const voted = await store.verdict(owner, intent, at + 1); expect(voted.verdict).toMatchObject({ codeAction: "BUY", codeRule: "selected" });
    await store.observe(owner, record.id, "SKIP", "budget");
    await expect(store.verdict(owner, { ...intent, key: randomUUID() }, at + 2)).rejects.toThrow("review_conflict");
    expect(db.prepare("SELECT count(*) AS n FROM decision_review_verdicts").get()?.n).toBe(1);
    const replay = await store.verdict(owner, intent, at + 3);
    expect(replay).toMatchObject({ codeAction: "SKIP", codeRule: "budget", verdict: { value: "agree", codeAction: "BUY", codeRule: "selected" } });
    await store.verdict(owner, { ...intent, key: randomUUID(), value: "disagree", expectedCode: { action: "SKIP", rule: "budget" } }, at + 4);
  });
  it("a source policy refusal closes only its unconsumed admission while preserving initial terms and human Agree", async () => {
    const { store } = fixture(), stale = await held(store), next = await store.capture(owner, decision({ runId: stale.runId, ordinal: 1 }), at);
    await store.verdict(owner, { id: stale.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1);
    await store.observe(owner, stale.id, "SKIP", "terms-changed");
    expect(await store.read(owner, stale.id)).toMatchObject({ state: "cancelled", initialCodeAction: "BUY", codeAction: "SKIP", codeRule: "terms-changed", verdict: { value: "agree", codeAction: "BUY", codeRule: "selected" } });
    await expect(store.consume(owner, stale.id, stale.terms, at + 2)).rejects.toThrow("review_conflict");
    expect((await store.begin(owner, next.id, at + 2)).state).toBe("held");
  });
  it("starts each deadline at its one-time live activation and never extends accepted authority", async () => {
    const { store } = fixture(); await store.ready();
    const first = await store.capture(owner, decision(), at), second = await store.capture(owner, decision({ runId: first.runId, ordinal: 1 }), at);
    expect(first.state).toBe("observed"); expect(second.expiresAt).toBeNull();
    const active = await store.begin(owner, first.id, at + 2 * REVIEW_WAIT_MS);
    expect(Date.parse(active.expiresAt!)).toBe(at + 3 * REVIEW_WAIT_MS);
    await expect(store.begin(owner, first.id, at + 4 * REVIEW_WAIT_MS)).rejects.toThrow("review_conflict");
    expect((await store.begin(owner, second.id, at + 4 * REVIEW_WAIT_MS)).expiresAt).toBe(new Date(at + 5 * REVIEW_WAIT_MS).toISOString());
    await store.cancel(owner, first.runId);
    await expect(store.begin(owner, second.id, at + 6 * REVIEW_WAIT_MS)).rejects.toThrow("review_conflict");
  });
  it("keeps identity/private reasons separate and denies another owner", async () => {
    const { store } = fixture(), record = await held(store);
    expect(await store.read(other, record.id)).toBeNull(); expect(await store.list(other, record.runId)).toEqual([]);
    await expect(store.verdict(other, { id: record.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1)).rejects.toThrow("review_not_found");
    const key = randomUUID(), input = { id: record.id, key, context: "gate" as const, value: "agree" as const, reason: "private reason" };
    await store.verdict(owner, input, at + 1);
    expect((await store.consume(owner, record.id, record.terms, at + 2)).state).toBe("consumed");
    expect((await store.verdict(owner, input, at + 3)).state).toBe("consumed");
    await expect(store.verdict(owner, { ...input, value: "disagree" }, at + 3)).rejects.toThrow("review_conflict");
    await expect(store.consume(owner, record.id, record.terms, at + 3)).rejects.toThrow("review_conflict");
  });
  it("only one competing gate verdict and one approved consume succeeds", async () => {
    const { store } = fixture(), record = await held(store);
    const verdicts = await Promise.allSettled(["agree", "disagree"].map(value => store.verdict(owner, { id: record.id, key: randomUUID(), context: "gate", value: value as "agree" | "disagree" }, at + 1)));
    expect(verdicts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const consumes = await Promise.allSettled([store.consume(owner, record.id, record.terms, at + 2), store.consume(owner, record.id, record.terms, at + 2)]);
    expect(consumes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  });
  it("refuses expired agreement, late consumed approval and changed exact terms", async () => {
    const { store } = fixture(), expired = await held(store);
    await expect(store.verdict(owner, { id: expired.id, key: randomUUID(), context: "gate", value: "agree" }, at + REVIEW_WAIT_MS)).rejects.toThrow("review_expired");
    await store.expire(owner, expired.id, at + REVIEW_WAIT_MS); expect((await store.read(owner, expired.id))?.state).toBe("expired");
    const record = await held(store);
    await store.verdict(owner, { id: record.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1);
    await expect(store.consume(owner, record.id, { ...record.terms, priceMicroUsdc: "5001" }, at + 2)).rejects.toThrow("review_conflict");
    await expect(store.consume(owner, record.id, record.terms, at + REVIEW_WAIT_MS)).rejects.toThrow("review_expired");
  });
  it("records later disagreement without changing consumed admission or financial originals", async () => {
    const { db, store } = fixture(), record = await held(store);
    db.exec("CREATE TABLE synthetic_originals (id TEXT PRIMARY KEY, value TEXT NOT NULL)"); db.prepare("INSERT INTO synthetic_originals VALUES('original','settled-original-bytes')").run();
    await store.verdict(owner, { id: record.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1);
    await store.consume(owner, record.id, record.terms, at + 2);
    const result = await store.verdict(owner, { id: record.id, key: randomUUID(), context: "opinion", expectedCode: { action: "BUY", rule: "selected" }, value: "disagree", reason: "not useful" }, at + REVIEW_WAIT_MS * 2);
    expect(result.state).toBe("consumed"); expect(result.verdict?.value).toBe("disagree");
    expect(db.prepare("SELECT value FROM synthetic_originals").get()?.value).toBe("settled-original-bytes");
    expect(db.prepare("SELECT count(*) AS n FROM decision_review_verdicts").get()?.n).toBe(2);
  });
  it("does not count human held/declined/cancelled records as code refusals or infer outside people", async () => {
    const { store } = fixture();
    const active = await held(store);
    await store.verdict(owner, { id: active.id, key: randomUUID(), context: "gate", value: "disagree", reason: "PRIVATE" }, at + 1);
    const cancelled = await store.capture(owner, decision(), at); await store.cancel(owner, cancelled.runId);
    await store.capture(owner, decision({ modelAction: "BUY", codeAction: "SKIP", codeRule: "portfolio" }), at);
    await store.capture(owner, decision({ modelAction: "SKIP", codeAction: "SKIP", codeRule: "model-skip", cohort: "team", cohortEvidence: "reviewed-team-fixture" }), at);
    const summary = await store.metrics("eip155:5042002", "2026-10-09T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    expect(summary.cohorts.find(row => row.cohort === "unknown")).toMatchObject({ decisions: 3, agrees: 0, disagrees: 1, agreementRate: 0, codeRefusals: 1, modelCodeDifferences: 1, refusalReasons: { portfolio: 1 } });
    expect(summary.cohorts.find(row => row.cohort === "outside")).toMatchObject({ decisions: 0, agreementRate: null });
    expect(decisionReviewMetricsSchema.parse(summary)).toEqual(summary);
    expect(JSON.stringify(summary)).not.toMatch(/PRIVATE|0x111|source-one|exact-version-one|runId|wallet/);
  });
  it("preserves captured policy/model and initial code while last-mile rules change the public projection", async () => {
    const { store } = fixture(), record = await store.capture(owner, decision({ modelAction: null }), at);
    await store.observe(owner, record.id, "SKIP", "budget");
    expect(await store.read(owner, record.id)).toMatchObject({ modelAction: null, engine: "synthetic", policyVersion: "captured-owner-decisions-v1", initialCodeAction: "BUY", initialCodeRule: "selected", codeAction: "SKIP", codeRule: "budget" });
    await expect(store.metrics("eip155:5042002", "2026-02-30T00:00:00.000Z", "2026-03-05T00:00:00.000Z")).rejects.toThrow();
  });
  it("refuses foreign/unknown schema without repairing or touching it", () => {
    const db = new DatabaseSync(":memory:"); connections.push(db);
    db.exec("CREATE TABLE decision_review_records (private TEXT)");
    expect(() => createSqliteDecisionReviews(db)).toThrow("review_unavailable");
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='decision_review_verdicts'").get()).toBeUndefined();
  });
  it.each([1e-15, -1e-15, 0.050001000000001, Infinity, -0, Number.MAX_SAFE_INTEGER])("never repairs malformed exact amount %s", amount => {
    expect(() => reviewMicros(amount)).toThrow();
  });
});
