import type { QueryRun } from "../types";
import { type RunClaimBinding, type RunClaimsStore } from "./contracts";
import { prepareRunClaimDelivery } from "./service";
import { privateRunClaimPacketSchema, type PrivateRunClaimPacket } from "./private-packet";
export { privateRunClaimPacketSchema, type PrivateRunClaimPacket } from "./private-packet";

/** Caller-private one-shot transport packet. Never a field of QueryRun, public
 * RemoteResearchResult/keryxMeta, a receipt, report, trace, export or analytics. */
interface Options {
  enabled: boolean; runId: string; owner?: string; binding: RunClaimBinding;
  db(): Promise<{ readonly runClaims?: RunClaimsStore }>;
}
/** Prepare before providers/research. Default-off and owned requests never even
 * open a claim store. Admission failure must not start an unclaimable new run.
 * Completion is invoked only after the caller's trusted persistence boundary. */
export async function preparePrivateRunClaim(options: Options) {
  if (!options.enabled || options.owner) return null;
  const prepared = await prepareRunClaimDelivery(await options.db(), options.binding, options.runId);
  let completed = false;
  return Object.freeze({ async complete(run: QueryRun): Promise<PrivateRunClaimPacket | null> {
    if (completed) return null;
    completed = true;
    try {
      const delivery = await prepared.complete(run);
      return delivery ? privateRunClaimPacketSchema.parse({ version: 1, runId: run.id, status: "available", delivery }) : null;
    } catch {
      // The answer/payment record was already saved. A late claim-store failure
      // must not discard that completed answer or replay paid research.
      return privateRunClaimPacketSchema.parse({ version: 1, runId: options.runId, status: "unavailable" });
    }
  } });
}

/** Private delivery builders call this separately from their public answer builders. */
export function privateRunClaimText(packet: PrivateRunClaimPacket) {
  const value = privateRunClaimPacketSchema.parse(packet);
  return value.status === "available"
    ? `Private account claim (single use, expires ${value.delivery.expiresAt}): ${value.delivery.claimUrl}\nKeep this link private. It attaches history ownership only; payer, receipts and creator rewards stay unchanged. A lost response cannot reissue it.`
    : "This completed research was saved, but its private account claim is unavailable. No link can be reissued; do not repeat paid research to recover one.";
}
