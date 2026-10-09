import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AcceptanceError, acceptanceAuthoritySchema, acceptanceInputSchema, acceptanceWallet, deliverableIdSchema,
  networkSchema, publicAcceptanceSchema, type DeliverableAcceptanceStore } from "../deliverable-acceptance/contracts";
import { acceptanceMetrics, originalBinding, ownerSnapshot } from "../deliverable-acceptance/original";

const bundleSchema = z.object({ storeId: z.string().uuid(), originalText: z.string().max(4_194_304),
  latest: z.unknown(), pendingPaymentLegs: z.boolean() }).strict();
/** Ordinary service-role RPC only. Missing migration/enrolled authority never falls back to REST. */
export function createSupabaseDeliverableAcceptance(client: SupabaseClient): DeliverableAcceptanceStore {
  const call = async (name: string, args: Record<string, unknown>) => {
    try { const { data, error } = await client.rpc(name, args);
      if (error) {
        if (error.code === "P0001" && ["acceptance_conflict", "acceptance_unauthenticated"].includes(error.message))
          throw new AcceptanceError(error.message as "acceptance_conflict" | "acceptance_unauthenticated");
        throw new AcceptanceError("acceptance_unavailable");
      }
      return data;
    } catch (error) { if (error instanceof AcceptanceError) throw error; throw new AcceptanceError("acceptance_unavailable"); }
  };
  const args = (owner: string, network: string, id: string) => ({ p_owner: acceptanceWallet(owner), p_network: networkSchema.parse(network), p_id: deliverableIdSchema.parse(id) });
  const parse = (value: unknown, lookup: ReturnType<typeof args>) => {
    try { const bundle = bundleSchema.parse(value), binding = originalBinding(bundle.storeId, bundle.originalText, lookup.p_owner, lookup.p_network, lookup.p_id);
      return { bundle, binding, snapshot: ownerSnapshot(binding, lookup.p_owner, lookup.p_network, lookup.p_id, bundle.latest, bundle.pendingPaymentLegs) };
    } catch (error) { if (error instanceof AcceptanceError) throw error; throw new AcceptanceError("acceptance_unavailable"); }
  };
  return Object.freeze({
    async read(owner, network, id) { const lookup = args(owner, network, id); return parse(await call("deliverable_acceptance_read_v1", lookup), lookup).snapshot; },
    async submit(owner, network, id, raw, authority) {
      const lookup = args(owner, network, id), input = acceptanceInputSchema.parse(raw), auth = acceptanceAuthoritySchema.parse(authority);
      const before = parse(await call("deliverable_acceptance_read_v1", lookup), lookup);
      if (before.binding.originalFingerprint !== input.originalFingerprint || before.binding.deliveredDigest !== input.deliveredDigest) throw new AcceptanceError("acceptance_conflict");
      const result = parse(await call("deliverable_acceptance_submit_v1", { ...lookup, p_input: input, p_authority: auth,
        p_original_sha256: before.binding.originalTextSha256 }), lookup);
      if (result.binding.originalFingerprint !== input.originalFingerprint || result.binding.deliveredDigest !== input.deliveredDigest ||
        result.snapshot.revision < input.expectedRevision + 1) throw new AcceptanceError("acceptance_unavailable");
      return result.snapshot;
    },
    async publicState(network, id) {
      try { return publicAcceptanceSchema.parse(await call("deliverable_acceptance_public_v1", { p_network: networkSchema.parse(network), p_id: deliverableIdSchema.parse(id) })); }
      catch { throw new AcceptanceError("acceptance_unavailable"); }
    },
    async metrics(network) {
      try { const states = z.array(publicAcceptanceSchema).max(1000).parse(await call("deliverable_acceptance_metrics_v1", { p_network: networkSchema.parse(network) }));
        return acceptanceMetrics(states);
      } catch { throw new AcceptanceError("acceptance_unavailable"); }
    },
  } satisfies DeliverableAcceptanceStore);
}
