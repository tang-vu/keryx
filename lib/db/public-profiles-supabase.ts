import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PublicProfileError, publicHandle, publicProfileActor, publicProfileInput, publicProfileSettings,
  publicProfileSnapshot, type PublicProfilesStore } from "../profiles/public-profile";
import { publicRun, type PublicRunSource } from "../profiles/public-profile-projection";

const source = z.object({id:z.string(),question:z.string().max(4000),createdAt:z.string(),
  citations:z.array(z.object({marker:z.string(),sourceName:z.string(),itemUrl:z.string().optional()}).strict()).max(50),
  provenance:z.unknown().optional(),usage:z.unknown().optional(),paymentMode:z.enum(["real","offline"]).optional(),
  fundingOwner:z.enum(["browser","treasury","offline"]).optional(),askerFunded:z.boolean().optional()}).strict();
const packet = z.object({profile:publicProfileSnapshot.omit({runs:true}),
  runs:z.array(z.object({source,claimed:z.boolean(),networks:z.array(z.string()).max(3)}).strict()).max(50)}).strict();

/** Fixed ordinary, service-role RPC. No REST/native fallback, retry or profile-ownership inference. */
export function createSupabasePublicProfiles(client: SupabaseClient, claimsEnabled = false): PublicProfilesStore {
  const call = async (action: string, handle: string | null, actor: unknown, input: unknown) => {
    try {
      const { data, error } = await client.rpc("public_researcher_profile_v1", { p_action: action, p_handle: handle,
        p_actor: actor, p_input: input, p_claims: claimsEnabled }).abortSignal(AbortSignal.timeout(15000));
      if (error) { const code = ["profile_required", "conflict", "unauthenticated", "not_owned"].find(value => value === error.message);
        throw new PublicProfileError((code || "public_profile_unavailable") as PublicProfileError["code"]); }
      if (JSON.stringify(data).length>8*1024*1024) throw new PublicProfileError("public_profile_unavailable");
      return z.object({ version: z.literal(1), action: z.literal(action), handle: handle === null ? z.null() : z.literal(handle), result: z.unknown() }).strict().parse(data).result;
    } catch (error) { if (error instanceof PublicProfileError) throw error; throw new PublicProfileError("public_profile_unavailable"); }
  };
  const checked = <T>(body: unknown, schema: { parse(value: unknown): T }): T => {
    try { return schema.parse(body); } catch { throw new PublicProfileError("public_profile_unavailable"); }
  };
  return Object.freeze({
    async read(rawHandle) { const handle = publicHandle.parse(rawHandle), value = await call("read",handle,null,{});
      if(value===null)return null;
      const raw=checked(value,packet);
      let result;try{result=publicProfileSnapshot.parse({...raw.profile,runs:raw.runs.map(row=>publicRun(row.source as PublicRunSource,row.claimed,row.networks))});}
      catch{throw new PublicProfileError("public_profile_unavailable");}
      if (result.handle !== handle) throw new PublicProfileError("public_profile_unavailable"); return result; },
    async settings(actor) { return checked(await call("settings",null,publicProfileActor.parse(actor),{}),publicProfileSettings); },
    async update(actor,input) { const parsed = publicProfileInput.parse(input);
      const result = checked(await call("update",null,publicProfileActor.parse(actor),parsed),publicProfileSettings);
      if (result.published !== parsed.published || result.revision !== parsed.revision+1 || JSON.stringify(result.fields) !== JSON.stringify(parsed.fields)
        || JSON.stringify(result.runIds) !== JSON.stringify(parsed.runIds)) throw new PublicProfileError("public_profile_unavailable"); return result; },
    async unpublish(actor) { checked(await call("unpublish",null,publicProfileActor.parse(actor),{}),z.object({ unpublished:z.literal(true) }).strict()); },
    async sitemap(take) { z.number().int().min(1).max(1000).parse(take);
      return checked(await call("sitemap",null,null,{take}),z.array(z.object({handle:publicHandle,updatedAt:z.string().datetime()}).strict()).max(take)); }
  } satisfies PublicProfilesStore);
}
