import { accountSessionContext } from "../account-sessions";
import { verifyApiKey } from "../api-keys";
import { parseScopes } from "../api-key-scopes";
import { config } from "../config";
import { getSession } from "../auth";
import { runClaimBindingSchema } from "../run-claims/contracts";
import { privacyReadsActive, privacyWallet, type PrivacyActor, type PrivacyStage } from "./contracts";
import { privateRunResponse } from "../run-claims/private-response";
export const privacyBinding = () => runClaimBindingSchema.parse({network:config.networkId,origin:config.baseUrl});
export async function pagePrivacyActor(stage?:PrivacyStage): Promise<PrivacyActor | undefined> {
  if(stage&&!privacyReadsActive(stage))return undefined;
  const session=await getSession();
  return session ? {wallet:privacyWallet.parse(session.address),binding:privacyBinding()} : undefined;
}
/** Invalid/revoked/insufficient keys never fall back to a cookie; body addresses grant no authority. */
export async function requestPrivacyActor(request: Request,stage?:PrivacyStage): Promise<PrivacyActor | undefined | Response> {
  if(stage&&!privacyReadsActive(stage))return undefined;
  const expected=request.headers.get("x-keryx-expected-wallet");
  const check=(actor:PrivacyActor | undefined) => expected!==null && (!privacyWallet.safeParse(expected).success || actor?.wallet!==expected.toLowerCase())
    ? privateRunResponse(Response.json({error:"owner_changed"},{status:409})) : actor;
  const authorization=request.headers.get("authorization");
  if(authorization!==null) {
    if(!/^Bearer kx_live_[0-9a-f]{96}$/.test(authorization)) return privateRunResponse(Response.json({error:"unauthenticated"},{status:401}));
    const key=await verifyApiKey(authorization.slice(7));
    if(!key) return privateRunResponse(Response.json({error:"unauthenticated"},{status:401}));
    if(!parseScopes(key.scopes).includes("history:read")) return privateRunResponse(Response.json({error:"insufficient_scope"},{status:403}));
    return check({wallet:privacyWallet.parse(key.walletAddress),binding:privacyBinding()});
  }
  return check(await pagePrivacyActor());
}
export async function mutationPrivacyContext(request: Request) {
  const binding=privacyBinding(), expected=privacyWallet.safeParse(request.headers.get("x-keryx-expected-wallet"));
  const deny=(error:string,status:number) => privateRunResponse(Response.json({error},{status}));
  if(request.headers.has("authorization")) return deny("interactive_session_required",403);
  if(request.headers.get("origin")!==binding.origin || request.headers.get("sec-fetch-site")==="cross-site") return deny("same_origin_required",403);
  if(!expected.success) return deny("owner_precondition_required",428);
  const context=await accountSessionContext(); if(context instanceof Response) return privateRunResponse(context);
  if(expected.data!==context.wallet) return deny("owner_changed",409);
  return {db:context.db,actor:{wallet:context.wallet,sessionHash:context.currentId,binding}};
}
