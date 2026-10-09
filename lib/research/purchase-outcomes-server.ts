import { config } from "../config";
import { resolveDispatch } from "../history/read-dispatch";
import { publicQueryRun } from "./public-query-run";
import { purchaseOutcomeId } from "./purchase-outcomes-contract";
import { projectPurchaseOutcomes } from "./purchase-outcomes-projector";

/** Reuse exactly the public-by-design permalink and its redacted representation.
 * The resolver selects records, not public provenance or participant identity. A current-store failure is
 * terminal, never an excuse to select a different store or disclose sidecars. */
export async function readPublicPurchaseOutcomes(id: string) {
  purchaseOutcomeId.parse(id);
  const dispatch = await resolveDispatch(id);
  if (!dispatch) return null;
  // Resolver metadata, including explicit null for a current record, overrides
  // any look-alike archive property retained in the run's arbitrary JSON data.
  return projectPurchaseOutcomes({ ...publicQueryRun(dispatch.run), archive: dispatch.archive ?? null }, config.networkId);
}
