import type { AgentDecisionReviews, DecisionReview, DecisionReviewsStore, ReviewVerdictInput } from "./decision-review-types";
import { DecisionReviewError, REVIEW_WAIT_MS, reviewOwner } from "./decision-review-types";

type Slot = { owner: string; sessionHash: string | null; resolve: () => void };
// Same live process/stream only, like the existing signature broker. No stored
// verdict can recreate an execution after disconnect/restart or on another node.
const waiting = new Map<string, Slot>();
export function hasLiveDecisionReview(owner: string, id: string, sessionHash: string | null) { const slot = waiting.get(id); return slot?.owner === reviewOwner(owner) && slot.sessionHash === sessionHash; }
export async function recordLiveReviewVerdict(store: DecisionReviewsStore, owner: string, input: ReviewVerdictInput, sessionHash: string | null) {
  if (input.context === "gate" && !hasLiveDecisionReview(owner, input.id, sessionHash)) {
    // Exact retry readback is permitted after consumption/cancellation, but it
    // cannot create a new gate verdict without its original live continuation.
    const existing = await store.read(owner, input.id);
    if (!existing || existing.state === "held") throw new DecisionReviewError("review_live_required");
  }
  const result = await store.verdict(owner, input);
  if (input.context === "gate" && hasLiveDecisionReview(owner, input.id, sessionHash)) waiting.get(input.id)?.resolve();
  return result;
}
export function createLiveDecisionReviews(options: {
  owner: string; store: DecisionReviewsStore; reviewFirst: boolean; signal: AbortSignal;
  sessionHash: string | null;
  verifyOwnerAndGrant: () => Promise<void>;
  send: (event: "decision-review" | "decision-review-request" | "decision-review-result", data: DecisionReview) => void;
  cohort: "team" | "scripted" | "unknown"; cohortEvidence: string | null;
}): { reviews: AgentDecisionReviews; close(runId: string): Promise<void> } {
  const owner = reviewOwner(options.owner);
  if (options.reviewFirst && !options.sessionHash?.match(/^[0-9a-f]{64}$/)) throw new DecisionReviewError("review_unsupported");
  let closed = false;
  const active = new Set<string>();
  const reviews: AgentDecisionReviews = {
    async capture(input) {
      if (closed || options.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
      const record = await options.store.capture(owner, { ...input, reviewFirst: options.reviewFirst, cohort: options.cohort, cohortEvidence: options.cohortEvidence });
      if (!options.reviewFirst || !record.terms.owned || record.codeAction === "SKIP") options.send("decision-review", record);
      return record;
    },
    async admit(record, currentTerms) {
      if (!options.reviewFirst) return true;
      if (record.state !== "observed" || closed || options.signal.aborted) return false;
      if (waiting.has(record.id)) throw new DecisionReviewError("review_conflict");
      record = await options.store.begin(owner, record.id);
      if (closed || options.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
      await new Promise<void>((resolve, reject) => {
        const abort = () => finish(new DOMException("Research cancelled", "AbortError"));
        const deadline = Math.max(0, Math.min(REVIEW_WAIT_MS, Date.parse(record.expiresAt!) - Date.now()));
        const timer = setTimeout(() => finish(new DecisionReviewError("review_expired")), deadline);
        const finish = (error?: Error) => {
          clearTimeout(timer); options.signal.removeEventListener("abort", abort);
          waiting.delete(record.id); active.delete(record.id); if (error) reject(error); else resolve();
        };
        waiting.set(record.id, { owner, sessionHash: options.sessionHash, resolve: () => finish() }); active.add(record.id);
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) { abort(); return; }
        // Arm the slot before sending, so an immediate verdict cannot race it.
        try { options.send("decision-review-request", record); } catch { finish(new DecisionReviewError("review_unavailable")); }
      }).catch(async error => { if (error instanceof DecisionReviewError && error.code === "review_expired") { await options.store.expire(owner, record.id); return; } throw error; });
      if (closed || options.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
      const result = await options.store.read(owner, record.id);
      if (!result || result.state !== "approved") { if (result) options.send("decision-review-result", result); return false; }
      await options.verifyOwnerAndGrant();
      if (closed || options.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
      const terms = await currentTerms();
      if (closed || options.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
      // The authority can change while registry/claim terms are being refreshed.
      await options.verifyOwnerAndGrant();
      if (closed || options.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
      const consumed = await options.store.consume(owner, record.id, terms);
      if (closed || options.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
      options.send("decision-review-result", consumed);
      if (closed || options.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
      return true;
    },
    async observe(record, action, rule) { await options.store.observe(owner, record.id, action, rule); const current = await options.store.read(owner, record.id); if (current && !closed && !options.signal.aborted) options.send("decision-review", current); },
  };
  return { reviews, async close(runId) { closed = true; for (const id of active) { waiting.get(id)?.resolve(); waiting.delete(id); } active.clear(); await options.store.cancel(owner, runId); } };
}
