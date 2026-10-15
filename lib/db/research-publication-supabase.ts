import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { QueryRun } from "../types";
import { runClaimBindingSchema } from "../run-claims/contracts";
import { PrivacyError, privacyWallet, validatePrivacyRun, visibilitySchema,
  type PrivacyActor, type RunVisibility } from "../run-privacy/contracts";
import { recordedRunProvenance } from "../research/run-provenance";
import { runEvidenceMetrics } from "./dashboard-metrics";
import { economicsRunSample } from "../economics/testnet-economics";

const choice = z.object({ visibility: visibilitySchema }).strict();
const limit = 4 * 1024 * 1024;
const unavailable = () => new PrivacyError("privacy_unavailable");

/** Ordinary storage only. The source-installed RPC checks its own and both
 * predecessor seals; there is no REST fallback or runtime schema installation. */
export function createSupabaseResearchPublication(client: SupabaseClient) {
  async function call(action: "ready" | "defaults" | "save", id: string | null, input: unknown) {
    try {
      if (Buffer.byteLength(JSON.stringify(input), "utf8") > limit) throw unavailable();
      const { data, error } = await client.rpc("research_publication_v1", { p_action: action, p_input: input })
        .abortSignal(AbortSignal.timeout(15000));
      if (error) throw unavailable();
      return z.object({ version: z.literal(1), action: z.literal(action),
        id: id === null ? z.null() : z.literal(id), result: z.unknown() }).strict().parse(data).result;
    } catch { throw unavailable(); }
  }
  return Object.freeze({
    async creationReady(): Promise<void> {
      try { z.object({ ready: z.literal(true) }).strict().parse(await call("ready", null, {})); }
      catch { throw unavailable(); }
    },
    async defaults(input: PrivacyActor): Promise<RunVisibility> {
      try {
        const wallet = privacyWallet.parse(input.wallet), binding = runClaimBindingSchema.parse(input.binding);
        return visibilitySchema.parse(await call("defaults", null, { wallet, binding }));
      } catch { throw unavailable(); }
    },
    async saveQueryRun(input: QueryRun, publication?: { visibility: RunVisibility }): Promise<void> {
      try {
        // Snapshot before awaiting: caller changes cannot alter the original or
        // creation choice in flight. No publication field enters QueryRun data.
        const serialized = JSON.stringify(input);
        if (Buffer.byteLength(serialized, "utf8") > limit) throw unavailable();
        let run = validatePrivacyRun(JSON.parse(serialized));
        if (run.id.startsWith("prv_") || run.parentId?.startsWith("prv_")) throw unavailable();
        run = recordedRunProvenance(run);
        const selected = publication === undefined ? undefined : choice.parse(publication);
        const evidence = runEvidenceMetrics(run);
        const row = {
          id: run.id, created_at: run.createdAt, question: run.question, budget: run.budget, engine: run.engine,
          total_spent: run.totalSpent, total_to_creators: run.totalToCreators, answer: run.answer, data: run,
          parent_id: run.parentId ?? null, asker: run.asker === undefined ? null : privacyWallet.parse(run.asker),
          origin: run.origin ?? "engine", mcp_client: run.mcpClient ?? null, duration_ms: run.durationMs ?? null,
          payment_mode: run.paymentMode ?? null, payment_attempts: run.paymentAttempts ?? null,
          settled_payments: run.settledPayments ?? null, confidence_level: run.confidence?.level ?? null,
          evidence_claim_count: evidence.evidenceClaimCount, grounded_claim_count: evidence.groundedClaimCount,
          rewarded_citation_count: evidence.rewardedCitationCount, economics_data: economicsRunSample(run),
        };
        z.object({ saved: z.literal(true) }).strict().parse(await call("save", run.id,
          { row, ...(selected === undefined ? {} : { publication: selected }) }));
      } catch { throw unavailable(); }
    },
  });
}
