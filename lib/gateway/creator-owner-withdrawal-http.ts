import { z } from "zod";
import { accountSessionContext } from "../account-sessions";
import { config } from "../config";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { requireMainnetGrantOrigin } from "../payments/mainnet-session-grants";
import { readBoundedRequestJson } from "../read-bounded-request-json";
import { checkWithdrawalRateLimit } from "./withdrawal-rate-limit";
import { createWithdrawalPrepareHandler } from "./withdrawal-prepare-handler";
import { creatorOwnerWithdrawalPolicy,submitCreatorOwnerWithdrawal,creatorOwnerWithdrawalStatus,completeCreatorOwnerWithdrawal } from "./creator-owner-withdrawal-service";

const id=z.string().regex(/^0x[0-9a-f]{64}$/),selector=z.object({id}).strict(),completed=selector.extend({transactionHash:id}).strict();
export async function creatorOwnerWithdrawalHttp(operation:"prepare"|"submit"|"status"|"complete",req:Request):Promise<Response> {
  const headers={"Cache-Control":"no-store",Vary:"Cookie, Origin","Referrer-Policy":"no-referrer"};
  try {requireMainnetGrantOrigin(req);} catch {return Response.json({error:"Withdrawal origin refused"},{status:403,headers});}
  try {
    if(config.profile!==ARC_MAINNET_PROFILE) throw new Error();
    if(operation==="prepare") {
      const selected=creatorOwnerWithdrawalPolicy();
      // Establish actual storage write authority before exposing a priced draft.
      const context=await accountSessionContext();if(context instanceof Response) return context;
      await context.db.creatorOwnerWithdrawalAccounting(context.wallet);
      return createWithdrawalPrepareHandler({authenticate:accountSessionContext,limits:selected.limits,rpcUrl:config.rpcUrl,
        heightLimits:selected.heightLimits,profile:ARC_MAINNET_PROFILE})(req);
    }
    const context=await accountSessionContext();if(context instanceof Response) return context;
    const owner=context.wallet.toLowerCase(),limited=await checkWithdrawalRateLimit(context.db,owner,operation==="status"?"status":"submit");
    if(limited) return limited;
    if(req.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json") return Response.json({error:"JSON withdrawal body required"},{status:400,headers});
    const body=await readBoundedRequestJson(req,operation==="submit"?8192:2048);
    let result;
    if(operation==="submit") result=await submitCreatorOwnerWithdrawal(context.db,owner,body,req.signal,async()=>{
      req.signal.throwIfAborted();const current=await accountSessionContext();
      if(current instanceof Response || current.currentId!==context.currentId || current.wallet.toLowerCase()!==owner) throw new Error("Owner session unavailable");
      req.signal.throwIfAborted();
    });
    else if(operation==="status") result=await creatorOwnerWithdrawalStatus(context.db,owner,selector.parse(body).id,req.signal);
    else {const value=completed.parse(body);result=await completeCreatorOwnerWithdrawal(context.db,owner,value.id,value.transactionHash as `0x${string}`,req.signal);}
    const fresh=await accountSessionContext();
    if(fresh instanceof Response || fresh.currentId!==context.currentId || fresh.wallet.toLowerCase()!==owner) throw new Error();
    return Response.json(result??{error:"Original withdrawal not found"},{status:result?(operation==="submit"?202:200):404,headers});
  } catch {return Response.json({error:"Owner withdrawal unavailable; retain the original request"},{status:503,headers});}
}
