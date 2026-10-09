import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { captureDecisionSchema, decisionReviewSchema, decisionTermsSchema, reviewIdSchema, reviewOwner,
  reviewVerdictSchema, reviewActionSchema, reviewRuleSchema, reviewPeriodSchema, decisionReviewMetricsSchema, DecisionReviewError, type DecisionReviewsStore } from "../research/decision-review-types";

/** Ordinary service-role RPC only. Missing migration refuses; no REST or sealed fallback. */
export function createSupabaseDecisionReviews(client: SupabaseClient): DecisionReviewsStore {
  async function call(operation: string, owner: string | null, input: unknown) {
    try {
      const { data, error } = await client.rpc("decision_reviews_v1", { p_operation: operation, p_wallet: owner === null ? null : reviewOwner(owner), p_input: input });
      if (error) {
        if (error.code === "P0001" && ["review_conflict", "review_not_found", "review_expired"].includes(error.message)) throw new DecisionReviewError(error.message as "review_conflict" | "review_not_found" | "review_expired");
        throw new DecisionReviewError("review_unavailable");
      }
      return data;
    } catch (error) { if (error instanceof DecisionReviewError) throw error; throw new DecisionReviewError("review_unavailable"); }
  }
  const record = (value: unknown) => decisionReviewSchema.parse(value);
  return Object.freeze({
    async ready() { const result = await call("ready", null, {}); if (JSON.stringify(result) !== '{"ready":true}') throw new DecisionReviewError("review_unavailable"); },
    async capture(owner, input) { return record(await call("capture", owner, captureDecisionSchema.parse(input))); },
    async begin(owner, id) { return record(await call("begin", owner, { id: reviewIdSchema.parse(id) })); },
    async list(owner, runId) { return z.array(decisionReviewSchema).max(300).parse(await call("list", owner, { runId: reviewIdSchema.parse(runId) })); },
    async read(owner, id) { const result = await call("read", owner, { id: reviewIdSchema.parse(id) }); return result === null ? null : record(result); },
    async verdict(owner, input) { return record(await call("verdict", owner, reviewVerdictSchema.parse(input))); },
    async consume(owner, id, terms) { return record(await call("consume", owner, { id: reviewIdSchema.parse(id), terms: decisionTermsSchema.parse(terms) })); },
    async cancel(owner, runId) { await call("cancel", owner, { runId: reviewIdSchema.parse(runId) }); },
    async expire(owner, id) { await call("expire", owner, { id: reviewIdSchema.parse(id) }); },
    async observe(owner, id, action, rule) { await call("observe", owner, { id: reviewIdSchema.parse(id), action: reviewActionSchema.parse(action), rule: reviewRuleSchema.parse(rule) }); },
    async metrics(network, since, until) {
      const input = reviewPeriodSchema.parse({ network, since, until });
      const result = decisionReviewMetricsSchema.parse(await call("metrics", null, input));
      if (result.network !== input.network || result.since !== since || result.until !== until) throw new DecisionReviewError("review_unavailable");
      return result;
    },
  } satisfies DecisionReviewsStore);
}
