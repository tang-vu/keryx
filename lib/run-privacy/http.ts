import { z } from "zod";
import { getDb } from "../db";
import { privateRunResponse } from "../run-claims/private-response";
import { mutationPrivacyContext, requestPrivacyActor } from "./auth";
import { PrivacyError, privacyId, privacyMutation, requirePrivacy, visibilitySchema } from "./contracts";
import {publicFinancialPayment} from "./public";
const json=(value:unknown,status=200)=>privateRunResponse(Response.json(value,{status}));
export const privacyFailure=(error:unknown)=>json({error:error instanceof PrivacyError ? error.code : "privacy_unavailable"},
  error instanceof PrivacyError ? ({not_found:404,conflict:409,unauthenticated:401,retention_hold:409,privacy_unavailable:503}[error.code]) : 503);
async function body(request:Request) {
  if(!request.body || !/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type")??"")) throw new PrivacyError("conflict");
  const reader=request.body.getReader(), chunks:Uint8Array[]=[]; let size=0, timer:ReturnType<typeof setTimeout> | undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new PrivacyError("conflict"));void reader.cancel().catch(()=>undefined);},5000);});
  try {
    for(;;) {const {done,value}=await Promise.race([reader.read(),deadline]); if(done) break;size+=value.length;if(size>512) throw new PrivacyError("conflict");chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  } finally {clearTimeout(timer);await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export async function privacyDefaults(request:Request,write=false) {
  try {
    requirePrivacy(await getDb());
    if(write) {
      const context=await mutationPrivacyContext(request);if(context instanceof Response) return context;
      const input=z.object({visibility:visibilitySchema,requestId:z.string().uuid()}).strict().parse(await body(request));
      return json({wallet:context.actor.wallet,visibility:await requirePrivacy(context.db).setDefault(context.actor,input.visibility,input.requestId)});
    }
    const actor=await requestPrivacyActor(request);if(actor instanceof Response) return actor;if(!actor) return json({error:"unauthenticated"},401);
    return json({wallet:actor.wallet,visibility:await requirePrivacy(await getDb()).defaults(actor)});
  } catch(error) {return privacyFailure(error);}
}
export async function privacyRun(request:Request,rawId:string,action:"owner"|"visibility"|"erase"|"export") {
  try {
    requirePrivacy(await getDb());
    const id=privacyId.parse(rawId);
    if(action==="visibility"||action==="erase") {
      const context=await mutationPrivacyContext(request);if(context instanceof Response) return context;
      const input=privacyMutation.parse(await body(request));
      return json(await requirePrivacy(context.db)[action==="visibility"?"change":"erase"](id,context.actor,input));
    }
    const actor=await requestPrivacyActor(request);if(actor instanceof Response)return actor;if(!actor)return json({error:"unauthenticated"},401);
    const db=await getDb(),store=requirePrivacy(db);
    if(action==="export") {
      const requestId=z.string().uuid().parse(request.headers.get("x-keryx-request-id"));
      const item=await store.export(id,actor,requestId);
      const payments=await db.listCreatorPaymentAttemptsByQuery(id);
      const response=json({version:1,wallet:actor.wallet,...item,payments:payments.map(publicFinancialPayment)});
      response.headers.set("Content-Disposition",`attachment; filename="keryx-owner-${id}.json"`);return response;
    }
    const item=await store.owner(id,actor);return item?json({wallet:actor.wallet,...item}):json({error:"not_found"},404);
  } catch(error) {return privacyFailure(error);}
}
