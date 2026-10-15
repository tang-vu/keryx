import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseResearchPublication } from "./research-publication-supabase";
import { z } from "zod";
import { runClaimBindingSchema } from "../run-claims/contracts";
import { pendingPollSchema, PrivacyError, privacyId, privacyMutation, privacySession, privacyWallet, validatePrivacyRun, visibilitySchema,
  type PrivacyActor, type RunPrivacyStore } from "../run-privacy/contracts";

const state = z.object({ visibility: visibilitySchema, revision: z.number().int().min(0), erased: z.boolean() }).strict();
const item = z.object({ run:z.unknown(), state }).strict();
/** Fixed service-role RPC only; schema/authority errors never fall back to REST/native storage. */
export function createSupabaseRunPrivacy(client: SupabaseClient, claimsEnabled = false): RunPrivacyStore {
  const publication = createSupabaseResearchPublication(client);
  function actor(input?: PrivacyActor, write=false) {
    if (!input) return null;
    return { wallet:privacyWallet.parse(input.wallet), binding:runClaimBindingSchema.parse(input.binding),
      sessionHash:write ? privacySession.parse(input.sessionHash) : null };
  }
  async function call(action: string, id: string | null, input: unknown, who: ReturnType<typeof actor>) {
    try {
      const {data,error}=await client.rpc("run_privacy_v1", {p_action:action,p_id:id,p_input:input,p_actor:who,p_claims:claimsEnabled})
        .abortSignal(AbortSignal.timeout(15000));
      if (error) {
        const code=["not_found","conflict","unauthenticated","retention_hold"].find(value => error.message === value);
        throw new PrivacyError(code as "not_found" | "conflict" | "unauthenticated" | "retention_hold" || "privacy_unavailable");
      }
      const packet=z.object({version:z.literal(1),action:z.literal(action),id:id===null ? z.null() : z.literal(id),result:z.unknown()}).strict().parse(data);
      return packet.result;
    } catch(error) { if(error instanceof PrivacyError) throw error; throw new PrivacyError("privacy_unavailable"); }
  }
  function checked(raw: unknown,id:string,who?:PrivacyActor) {
    const value=item.parse(raw),run=validatePrivacyRun(value.run,id);
    if(who && run.asker!==undefined && run.asker!==null && privacyWallet.parse(run.asker)!==privacyWallet.parse(who.wallet))throw new PrivacyError("privacy_unavailable");
    return {run,state:value.state};
  }
  return Object.freeze({
    async read(rawId,input) { const id=privacyId.parse(rawId), result=z.object({exists:z.boolean(),item:item.nullable()}).strict().parse(await call("read",id,{},actor(input)));
      if(result.item && !result.exists || result.item?.state.erased || result.item?.state.visibility==="private" && !input) throw new PrivacyError("privacy_unavailable");
      return {exists:result.exists,item:result.item ? checked(result.item,id,result.item.state.visibility==="private"?input:undefined) : null}; },
    async list(input) { z.number().int().min(1).max(2500).parse(input.take);
      const result=z.array(z.unknown()).max(input.take).parse(await call("list",null,input,null));
      return result.map(value => { const parsed=item.parse(value); if(parsed.state.visibility!=="public" || parsed.state.erased) throw new PrivacyError("privacy_unavailable"); return validatePrivacyRun(parsed.run); }); },
    async settlement(rawId) { const id=privacyId.parse(rawId),result=await call("settlement",id,{},null); return result===null ? null : validatePrivacyRun(result,id); },
    async pending(rawId) { const id=privacyId.parse(rawId),result=await call("pending",id,{},null);return result===null ? null : pendingPollSchema.extend({queryId:z.literal(id)}).parse(result); },
    async memories(take) { z.number().int().min(1).max(2500).parse(take);
      return z.array(z.object({id:privacyId,createdAt:z.string(),sourceScores:z.record(z.string(),z.object({name:z.string(),weight:z.number(),reward:z.number()})),
        topics:z.array(z.string()),sourcesRead:z.array(z.string()).optional()}).strict()).max(take).parse(await call("memories",null,{take},null)); },
    async offers(take) { z.number().int().min(1).max(200).parse(take);
      return z.array(z.object({id:z.string(),gapId:z.string(),sourceId:z.string(),sourceItemLink:z.string(),ownerWallet:z.string(),status:z.enum(["pending","running","filled","missed","unpaid","stale","failed"]),attempts:z.number().int(),
        itemId:z.string().optional(),contentVersion:z.string().optional(),articleOfferId:z.string().optional(),retryRunId:z.string().optional(),coverage:z.number().optional(),rewardUsdc:z.number().optional(),createdAt:z.string(),updatedAt:z.string()}).strict()).max(take).parse(await call("offers",null,{take},null)); },
    async owner(rawId,input) { const id=privacyId.parse(rawId),result=await call("owner",id,{},actor(input)); return result===null ? null : checked(result,id,input); },
    creationReady: publication.creationReady,
    defaults: publication.defaults,
    async setDefault(input,visibility,requestId) { z.string().uuid().parse(requestId); return visibilitySchema.parse(await call("default",null,{visibility:visibilitySchema.parse(visibility),requestId},actor(input,true))); },
    async change(rawId,input,mutation) { const id=privacyId.parse(rawId); return state.parse(await call("visibility",id,privacyMutation.parse(mutation),actor(input,true))); },
    async erase(rawId,input,mutation) { const id=privacyId.parse(rawId); return state.parse(await call("erase",id,privacyMutation.parse(mutation),actor(input,true))); },
    async export(rawId,input,requestId) { const id=privacyId.parse(rawId); z.string().uuid().parse(requestId); return checked(await call("export",id,{requestId},actor(input)),id,input); },
  } satisfies RunPrivacyStore);
}
