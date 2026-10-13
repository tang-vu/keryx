import { PublicProfileError, publicHandle, publicProfileInput, requirePublicProfiles } from "./public-profile";
import { authJson } from "../auth-challenge";
import type { KeryxDB } from "../db/keryx-db";
import type { RunClaimBinding } from "../run-claims/contracts";

async function body(req: Request) {
  if (!req.body || !req.headers.get("content-type")?.startsWith("application/json")) throw new Error();
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new Error());void reader.cancel().catch(()=>{});},5000);});
  try { for(;;){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;size+=part.value.length;if(size>8192)throw new Error();chunks.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return publicProfileInput.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
  } finally {clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function publicProfileFailure(error: unknown) {
  const code=error instanceof PublicProfileError ? error.code : "public_profile_unavailable";
  return authJson({error:code},code==="conflict" ? 409 : code==="unauthenticated" ? 401 : code==="not_owned" ? 403 : code==="profile_required" ? 409 : 503);
}
/** Publication requires a live revocable signed-wallet session, never a body wallet or inferred payer. */
export function createPublicProfileOwnerRoutes(deps:{session():Promise<{db:KeryxDB;wallet:string;currentId:string}|Response>;binding:RunClaimBinding}){
  const execute=async(req:Request,action:"settings"|"update"|"unpublish")=>{
    try{
      if(new URL(req.url).search)return authJson({error:"invalid_public_profile"},400);
      if(req.headers.has("authorization"))return authJson({error:"signed_wallet_session_required"},401);
      const expected=req.headers.get("x-keryx-expected-wallet");
      if(!expected)return authJson({error:"owner_precondition_required"},428);
      if(!/^0x[0-9a-fA-F]{40}$/.test(expected))return authJson({error:"invalid_owner_precondition"},400);
      // The reviewed public binding is authority; Next's internal transport URL
      // may use a loopback host. Never accept an origin merely because it matches
      // a caller-controlled request URL or forwarded Host.
      if(action!=="settings"&&req.headers.get("origin")!==deps.binding.origin)return authJson({error:"same_origin_required"},403);
      const context=await deps.session();if(context instanceof Response)return context;
      if(expected.toLowerCase()!==context.wallet.toLowerCase())return authJson({error:"profile_owner_changed"},409);
      const store=requirePublicProfiles(context.db),actor={wallet:context.wallet,sessionHash:context.currentId,binding:deps.binding};
      if(action==="settings")return authJson(await store.settings(actor));
      if(action==="unpublish"){await store.unpublish(actor);return authJson({unpublished:true});}
      let input;try{input=await body(req);}catch{return authJson({error:"invalid_public_profile"},400);}
      return authJson(await store.update(actor,input));
    }catch(error){return publicProfileFailure(error);}
  };
  return {GET:(req:Request)=>execute(req,"settings"),PUT:(req:Request)=>execute(req,"update"),DELETE:(req:Request)=>execute(req,"unpublish")};
}
export async function readPublicProfileJson(db:KeryxDB,rawHandle:string){
  const handle=publicHandle.safeParse(rawHandle);if(!handle.success||handle.data!==rawHandle)return authJson({error:"not_found"},404);
  try{const snapshot=await requirePublicProfiles(db).read(handle.data);return snapshot?authJson(snapshot):authJson({error:"not_found"},404);}
  catch(error){return publicProfileFailure(error);}
}
