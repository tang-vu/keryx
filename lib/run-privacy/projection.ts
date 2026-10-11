import type {QueryRun} from "../types";
import type {RunPrivacyStore} from "./contracts";
/** Preserve the existing adapter's evidence presentation after authorization.
 * Owner exports and original claim digests remain the exact stored record. */
export function withRunReadProjection(store:RunPrivacyStore,project:(run:QueryRun)=>Promise<QueryRun>):RunPrivacyStore {
  return Object.freeze({...store,async read(id,actor){
    const value=await store.read(id,actor);
    return value.item?{...value,item:{...value.item,run:await project(value.item.run)}}:value;
  }} satisfies RunPrivacyStore);
}
