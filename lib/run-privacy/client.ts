import { z } from "zod";
import { readBoundedJson } from "../read-bounded-json";
import { privacyId, privacyWallet, validatePrivacyRun, visibilitySchema } from "./contracts";
const snapshot=z.object({wallet:privacyWallet,run:z.unknown(),state:z.object({visibility:visibilitySchema,revision:z.number().int().min(0),erased:z.boolean()}).strict(),
  version:z.literal(1).optional(),payments:z.array(z.unknown()).optional()}).strict();
/** Fixed-origin read-only bridge. No cookies, redirects, signing, retries or model-selected URLs. */
export function createRunPrivacyClient(baseUrl:string,key:()=>string|undefined,fetcher:typeof fetch=fetch) {
  const base=new URL(baseUrl);if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||base.pathname!=="/")throw new Error("Use the HTTPS deployment origin");
  return {async read(rawId:string,requestId?:string) {
    const id=privacyId.parse(rawId),raw=key();if(!raw||!/^kx_live_[0-9a-f]{96}$/.test(raw))throw new Error("Explicit history-scoped key required");
    const headers=new Headers({Authorization:`Bearer ${raw}`});if(requestId)headers.set("X-Keryx-Request-Id",z.string().uuid().parse(requestId));
    const response=await fetcher(new URL(`/api/me/run-privacy/${id}${requestId?"/export":""}`,base),{
      method:"GET",headers,credentials:"omit",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();throw new Error("Owner read refused");}
    const value=snapshot.parse(await readBoundedJson(response,6*1024*1024));
    return {...value,run:validatePrivacyRun(value.run,id)};
  }};
}
