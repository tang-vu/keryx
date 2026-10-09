import "server-only";
import { config } from "../config";
import { resolveDispatch } from "../history/read-dispatch";
import { publicQueryRun } from "./public-query-run";
import { purchaseOutcomeId } from "./purchase-outcomes-contract";
import { projectPurchaseOutcomes } from "./purchase-outcomes-projector";

/** Reuse exactly the public permalink resolver. A current-store failure is
 * terminal, never an excuse to select a different store or disclose sidecars. */
export async function readPublicPurchaseOutcomes(id: string) {
  purchaseOutcomeId.parse(id);
  const dispatch = await resolveDispatch(id);
  if (!dispatch) return null;
  return projectPurchaseOutcomes({ ...publicQueryRun(dispatch.run),
    ...(dispatch.archive ? { archive: dispatch.archive } : {}) }, config.networkId);
}
