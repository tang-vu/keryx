import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createSqliteDecisionReviews } from "../db/decision-reviews-sqlite";
import { createLiveDecisionReviews, recordLiveReviewVerdict, hasLiveDecisionReview } from "./decision-review-live";
import { DecisionReviewError, REVIEW_WAIT_MS, type CaptureDecision, type DecisionReview } from "./decision-review-types";
import { assertDecisionReviewAuthority } from "./decision-review-authority";
const owner = `0x${"1".repeat(40)}`, hash = "a".repeat(64), otherHash = "b".repeat(64);
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.useRealTimers(); });
function fixture(over: { verify?: () => Promise<void>; send?: (event: string, record: DecisionReview) => void } = {}) {
  const db = new DatabaseSync(":memory:"), store = { ...createSqliteDecisionReviews(db) }, abort = new AbortController(), runId = randomUUID();
  cleanup.push(() => db.close());
  const events: { event: string; record: DecisionReview }[] = [], verify = vi.fn(over.verify ?? (async () => {}));
  const live = createLiveDecisionReviews({ owner, store, signal: abort.signal, reviewFirst: true, sessionHash: hash,
    verifyOwnerAndGrant: verify, cohort: "unknown", cohortEvidence: null, send(event, record) { events.push({ event, record }); over.send?.(event, record); } });
  cleanup.push(() => live.close(runId));
  const input: Omit<CaptureDecision, "reviewFirst" | "cohort" | "cohortEvidence"> = { policyVersion: "captured-owner-decisions-v1", engine: "synthetic", requestedModel: null,
    runId, round: 0, ordinal: 0, sourceName: "Synthetic private source", modelAction: "BUY", codeAction: "BUY", codeRule: "selected",
    terms: { assetId: "asset", sourceId: "source", owned: true, network: "eip155:5042002", payTo: owner, priceMicroUsdc: "1000", listPriceMicroUsdc: "1000", citationBudgetMicroUsdc: "5000" } };
  return { store, live, events, verify, abort, runId, input };
}
async function request(f: ReturnType<typeof fixture>, ordinal = 0) {
  const record = await f.live.reviews.capture({ ...f.input, ordinal });
  let emitted!: () => void; const ready = new Promise<void>(resolve => { emitted = resolve; });
  // Store's begin promise commits before the synchronously emitted request.
  const send = f.events.push.bind(f.events); f.events.push = (...rows) => { const n = send(...rows); if (rows.some(row => row.event === "decision-review-request")) emitted(); return n; };
  const terms = vi.fn(async () => record.terms), admission = f.live.reviews.admit(record, terms);
  await ready;
  return { record, admission, terms };
}
describe("live owner decision admission", () => {
  it("arms before an immediate verdict, consumes once and replays only the same intent/current readback", async () => {
    const f = fixture(), r = await request(f), verdict = { id: r.record.id, key: randomUUID(), context: "gate" as const, value: "agree" as const };
    expect(hasLiveDecisionReview(owner, r.record.id, hash)).toBe(true);
    await recordLiveReviewVerdict(f.store, owner, verdict, hash);
    expect(await r.admission).toBe(true); expect(f.verify).toHaveBeenCalledTimes(2); expect(r.terms).toHaveBeenCalledOnce();
    expect((await recordLiveReviewVerdict(f.store, owner, verdict, otherHash)).state).toBe("consumed");
    await expect(recordLiveReviewVerdict(f.store, owner, { ...verdict, key: randomUUID() }, otherHash)).rejects.toThrow("review_conflict");
    await expect(f.live.reviews.admit(r.record, r.terms)).rejects.toThrow("review_conflict");
  });
  it("refuses another web session even for the same wallet and leaves its original continuation waiting", async () => {
    const f = fixture(), r = await request(f), verdict = { id: r.record.id, key: randomUUID(), context: "gate" as const, value: "agree" as const };
    await expect(recordLiveReviewVerdict(f.store, owner, verdict, otherHash)).rejects.toThrow("review_live_required");
    expect((await f.store.read(owner, r.record.id))?.state).toBe("held"); expect(f.verify).not.toHaveBeenCalled();
    await recordLiveReviewVerdict(f.store, owner, { ...verdict, value: "disagree" }, hash); expect(await r.admission).toBe(false);
    expect(r.terms).not.toHaveBeenCalled();
  });
  it.each(["logout", "grant-revoked", "grant-epoch-changed"])("rechecks %s after approval before any terms/effect admission", async () => {
    const f = fixture({ verify: async () => { throw new DecisionReviewError("review_conflict"); } }), r = await request(f);
    const result = expect(r.admission).rejects.toThrow("review_conflict");
    await recordLiveReviewVerdict(f.store, owner, { id: r.record.id, key: randomUUID(), context: "gate", value: "agree" }, hash);
    await result; expect(r.terms).not.toHaveBeenCalled(); expect((await f.store.read(owner, r.record.id))?.state).toBe("approved");
    await f.live.close(f.runId); expect((await f.store.read(owner, r.record.id))?.state).toBe("cancelled");
  });
  it("binds refreshed exact terms and cannot consume a changed price or payee", async () => {
    const f = fixture(), r = await request(f); r.terms.mockResolvedValue({ ...r.record.terms, priceMicroUsdc: "1001" });
    const result = expect(r.admission).rejects.toThrow("review_conflict");
    await recordLiveReviewVerdict(f.store, owner, { id: r.record.id, key: randomUUID(), context: "gate", value: "agree" }, hash); await result;
    expect((await f.store.read(owner, r.record.id))?.state).toBe("approved");
  });
  it.each(["session", "grant"])("refuses %s revocation during an awaited terms refresh before consumption", async revoked => {
    const now = Date.now(), original = { sessionId: owner, sessAddr: owner, ownerAddr: owner, cap: 0.05, spent: 0,
      expiry: now + 120000, txHash: "synthetic", grantEpoch: "original" };
    let session: { hash: string; wallet: string; issuedAt: number; expiresAt: number } | null = { hash, wallet: owner, issuedAt: now - 1000, expiresAt: now + 120000 };
    let current: typeof original | undefined = original, release!: () => void, entered!: () => void;
    const refreshing = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({ verify: async () => assertDecisionReviewAuthority(owner, hash, session, original, current) }), r = await request(f);
    const consume = vi.spyOn(f.store, "consume"), effect = vi.fn();
    r.terms.mockImplementation(() => { entered(); return new Promise(resolve => { release = () => resolve(r.record.terms); }); });
    const refused = expect(r.admission.then(effect)).rejects.toThrow("review_conflict");
    await recordLiveReviewVerdict(f.store, owner, { id: r.record.id, key: randomUUID(), context: "gate", value: "agree" }, hash);
    await refreshing; if (revoked === "session") session = null; else current = undefined; release(); await refused;
    expect(f.verify).toHaveBeenCalledTimes(2); expect(consume).not.toHaveBeenCalled(); expect(effect).not.toHaveBeenCalled();
    expect((await f.store.read(owner, r.record.id))?.state).toBe("approved");
  });
  it("expires visibly without machine refusal and gives a later queued decision its own bounded window", async () => {
    vi.useFakeTimers(); const f = fixture(), next = await f.live.reviews.capture({ ...f.input, ordinal: 1 }), r = await request(f);
    await vi.advanceTimersByTimeAsync(REVIEW_WAIT_MS); expect(await r.admission).toBe(false);
    expect(f.events.at(-1)?.record).toMatchObject({ state: "expired", codeAction: "BUY", initialCodeAction: "BUY" });
    expect((await f.store.read(owner, next.id))?.expiresAt).toBeNull();
    const wait = f.live.reviews.admit(next, async () => next.terms); await vi.advanceTimersByTimeAsync(0);
    const active = await f.store.read(owner, next.id); expect(Date.parse(active!.expiresAt!) - Date.now()).toBe(REVIEW_WAIT_MS);
    await recordLiveReviewVerdict(f.store, owner, { id: next.id, key: randomUUID(), context: "gate", value: "disagree" }, hash); expect(await wait).toBe(false);
  });
  it("disconnect/restart cannot recreate a continuation from stored approval", async () => {
    const f = fixture(), r = await request(f), failed = expect(r.admission).rejects.toThrow("Research cancelled"); f.abort.abort(); await failed;
    await f.live.close(f.runId); expect(hasLiveDecisionReview(owner, r.record.id, hash)).toBe(false);
    await expect(recordLiveReviewVerdict(f.store, owner, { id: r.record.id, key: randomUUID(), context: "gate", value: "agree" }, hash)).rejects.toThrow("review_conflict");
    expect(await f.live.reviews.admit(r.record, r.terms)).toBe(false); expect(r.terms).not.toHaveBeenCalled();
  });
  it("closing while the grant refresh is suspended refuses consumption", async () => {
    let release!: () => void, entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({ verify: () => { entered(); return new Promise<void>(resolve => { release = resolve; }); } }), r = await request(f);
    const result = expect(r.admission).rejects.toThrow("Research cancelled");
    await recordLiveReviewVerdict(f.store, owner, { id: r.record.id, key: randomUUID(), context: "gate", value: "agree" }, hash);
    await started; await f.live.close(f.runId); release(); await result;
    expect((await f.store.read(owner, r.record.id))?.state).toBe("cancelled");
  });
});
