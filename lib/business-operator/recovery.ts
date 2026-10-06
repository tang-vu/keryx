import type { KeryxDB } from "../db/keryx-db";
import { repairA2aOrderFromSavedRun } from "../a2a/operator-resolution";
type RecoveryDb=Pick<KeryxDB,"getA2aOrder"|"getQueryRun"|"listCreatorPaymentAttemptsByQuery"|"resolveA2aOrder">;
/** Original-bound polling/metadata repair only: never claim, sign or collectRun.
 * A refused or missing original stays held for explicit operator inspection. */
export async function recoverOperatorOriginal(db:RecoveryDb,id:string):Promise<"completed"|"failed"|"held"> {
  const original=await db.getA2aOrder(id);
  if(!original)return "held";
  if(original.status!=="running")return original.status;
  if(!original.startedAt || original.id!==id || original.queryId!==id)return "held";
  const saved=await db.getQueryRun(id);
  if(!saved)return "held";
  try {
    const repaired=await repairA2aOrderFromSavedRun(db,original,saved,"automatic-poll");
    return repaired.status==="completed"?"completed":"held";
  }catch{return "held";}
}
