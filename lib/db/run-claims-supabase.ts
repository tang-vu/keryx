import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { RunClaimError, runClaimAttemptSchema, runClaimIssueSchema, runClaimIssuanceSchema,
  runClaimReceiptSchema, type RunClaimsStore } from "../run-claims/contracts";

/** Default-off ordinary RPC port; missing migration/native authority refuses, never REST. */
export function createSupabaseRunClaims(client: SupabaseClient): RunClaimsStore {
  async function call(name: string, args: Record<string, unknown>) {
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) {
        if (error.code === "P0001" && ["claim_unavailable", "claim_unauthenticated"].includes(error.message))
          throw new RunClaimError(error.message as "claim_unavailable" | "claim_unauthenticated");
        throw new RunClaimError("claims_unavailable");
      }
      return data;
    } catch (error) { if (error instanceof RunClaimError) throw error; throw new RunClaimError("claims_unavailable"); }
  }
  function parse<T>(value: unknown, schema: { parse(value: unknown): T }): T {
    try { return schema.parse(value); } catch { throw new RunClaimError("claims_unavailable"); }
  }
  return Object.freeze({
    async assertAvailable() {
      parse(await call("anonymous_run_claims_ready_v1", {}), z.object({ version: z.literal(1), ready: z.literal(true) }).strict());
    },
    async issue(raw) {
      let input;
      try { input = runClaimIssueSchema.parse(raw); } catch { throw new RunClaimError("claim_unavailable"); }
      const result = parse(await call("anonymous_run_claim_issue_v1", { p_run_id: input.runId, p_token_hash: input.tokenHash,
        p_completed_at: input.completedAt, p_network: input.binding.network, p_origin: input.binding.origin }), runClaimIssuanceSchema);
      if (result.runId !== input.runId || result.binding.network !== input.binding.network || result.binding.origin !== input.binding.origin)
        throw new RunClaimError("claims_unavailable");
      return result;
    },
    async claim(raw) {
      let input;
      try { input = runClaimAttemptSchema.parse(raw); } catch { throw new RunClaimError("claim_unavailable"); }
      const result = parse(await call("anonymous_run_claim_consume_v1", { p_token_hash: input.tokenHash,
        p_wallet: input.wallet, p_session_hash: input.sessionHash, p_network: input.binding.network, p_origin: input.binding.origin }), runClaimReceiptSchema);
      if (result.wallet !== input.wallet || result.binding.network !== input.binding.network || result.binding.origin !== input.binding.origin)
        throw new RunClaimError("claims_unavailable");
      return result;
    },
  } satisfies RunClaimsStore);
}
