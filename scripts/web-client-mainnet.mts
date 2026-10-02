import { createHash,randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, type Hex } from "viem";
import { SiweMessage } from "siwe";
import { ARC_MAINNET_PROFILE as profile } from "../lib/arc-network-profile";
import { paymentRuntimeConfig } from "../lib/payment-runtime-config";
import { chainForProfile } from "../lib/chains";
import { attestedArcAuthorityHttp } from "../lib/arc-rpc-attestation";
import { readBoundedJson } from "../lib/read-bounded-json";
import { createBrowserSessionKey } from "../lib/session/browser-session-key";
import { createBrowserSessionRuntime } from "../lib/session/browser-session-runtime";
import { browserSessionCustodyContext } from "../lib/session/browser-session-custody";
import { createSessionGrantConsentMessage, parseSessionGrantConsent } from "../lib/payments/session-grant-consent";
import type { SourcePaymentAuthority } from "../lib/payments/client-payto-allowlist";
import { REGISTRY_ABI } from "../lib/registry/registry-abi";
import { inspectHeadlessOriginal } from "./helpers/headless-mainnet-originals.mjs";
import { canonicalJson } from "../lib/canonical-json";
import { openHeadlessMainnetState } from "./helpers/headless-mainnet-state.mjs";

const refuse = (): never => { throw new Error("Headless mainnet admission refused; preserve original custody and attempts"); };
function micros(value: string | undefined) {
  if (!value || !/^[1-9]\d{0,15}$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) refuse();
  return BigInt(value!);
}

/** Mainnet owner-prefunded web flow. No faucet, raw transaction or automatic
 * treasury funding. Test ports do not change the production profile/HTTPS policy. */
export async function runHeadlessMainnet(args: string[], ports: {
  fetchImpl?: typeof fetch; readSource?: (registryId: string) => Promise<SourcePaymentAuthority>;
} = {}) {
  const [action, question, budgetValue, capValue] = args;
  if (!["prepare","status","recover","ask"].includes(action ?? "") ||
    (action !== "ask" ? args.length !== 1 : args.length !== 4 || !question || question.length > 20000)) refuse();
  const payment = paymentRuntimeConfig(); if (payment.profile !== profile) refuse();
  const origin = process.env.KERYX_BASE_URL ?? "https://keryx.cc", url = new URL(origin);
  if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password) refuse();
  const ownerKey = process.env.KERYX_HEADLESS_OWNER_PRIVATE_KEY, wrappingKey = process.env.KERYX_HEADLESS_WRAPPING_KEY;
  if (!ownerKey || !wrappingKey || !/^0x[0-9a-fA-F]{64}$/.test(ownerKey) || ownerKey.toLowerCase() === wrappingKey.toLowerCase() ||
    !process.env.KERYX_HEADLESS_STATE_DIRECTORY) refuse();
  const owner = privateKeyToAccount(ownerKey! as Hex), context = browserSessionCustodyContext(profile,origin,owner.address);
  const state = await openHeadlessMainnetState(process.env.KERYX_HEADLESS_STATE_DIRECTORY!,context,wrappingKey!,action === "prepare" || action === "ask");
  const key = createBrowserSessionKey(origin,owner.address,state);
  try {
    const retained = await state.retained.read(context.storageNamespace);
    if (retained) await key.restore();
    else if (action === "prepare" || action === "ask") await key.derive(await owner.signMessage({message:context.derivationMessage}));
    else refuse();
    if (action === "prepare" || action === "status") {
      console.log(JSON.stringify({network:profile.networkId,origin,owner:owner.address,session:key.address,
        originalAttempts:state.originalNonces().length, fundingState:"not_checked",
        notice:"Retain encrypted custody and wrapping environment. Owner funding uses exact approve plus Gateway depositFor; no funding transaction performed."}));
      return;
    }
    const fetchImpl = ports.fetchImpl ?? fetch, jar = new Map<string,string>();
    async function request(path: string, method = "GET", body?: unknown) {
      if (!path.startsWith("/") || path.startsWith("//")) refuse();
      const response = await fetchImpl(`${origin}${path}`,{method,redirect:"error",signal:AbortSignal.timeout(60000),
        headers:{"Content-Type":"application/json",Origin:origin,Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join("; ")},
        ...(body === undefined ? {} : {body:JSON.stringify(body)})});
      for (const cookie of response.headers.getSetCookie()) {const pair=cookie.split(";",1)[0],at=pair.indexOf("=");if(at>0)jar.set(pair.slice(0,at),pair.slice(at+1));}
      if (!response.ok) refuse(); return response;
    }
    const json = async (path: string, method?: string, body?: unknown) => readBoundedJson(await request(path,method,body));
    const nonceBody = await json("/api/auth/nonce") as {nonce?:unknown};
    if (typeof nonceBody.nonce !== "string" || !/^[a-zA-Z0-9]{8,256}$/.test(nonceBody.nonce)) refuse();
    const message = new SiweMessage({domain:url.host,address:owner.address,statement:"Sign in to Keryx.",uri:origin,
      version:"1",chainId:profile.chainId,nonce:nonceBody.nonce as string}).prepareMessage();
    await json("/api/auth/verify","POST",{message,signature:await owner.signMessage({message})});
    for (const original of state.unresolvedNonces()) {
      if (typeof original.req_id !== "string") refuse();
      const observation = await inspectHeadlessOriginal(await json(`/api/session/authorizations/${encodeURIComponent(String(original.req_id))}`),{
        context,signer:key.address!,reqId:String(original.req_id),nonce:String(original.nonce),epoch:String(original.epoch),amount:String(original.amount),cap:String(original.cap),original:JSON.parse(String(original.original)),requirementsDigest:String(original.requirements_digest)});
      if(observation.settlementConfirmed)state.recordSettled(observation.nonce,createHash("sha256").update(canonicalJson(observation)).digest("hex"));
      if(action==="recover")console.log(JSON.stringify(observation));
    }
    if(action==="recover")return;
    if(state.unresolvedNonces().length)refuse();
    const budget = micros(budgetValue), cap = micros(capValue);if(budget>cap)refuse();
    const questionScope=Object.freeze({id:randomUUID(),budgetMicroUsdc:String(budget)});
    let challenge = await json("/api/session/grant/challenge","POST",{sessAddr:key.address,budgetMicros:String(cap),recover:true}) as {consent?:unknown;funding?:{confirmedSpentMicroUsdc?:unknown}};
    const observedConfirmed=challenge.funding?.confirmedSpentMicroUsdc;
    if(typeof observedConfirmed!=="string"||!/^(0|[1-9]\d{0,15})$/.test(observedConfirmed)||BigInt(String(observedConfirmed))>cap)refuse();
    if(BigInt(String(observedConfirmed))>BigInt(0)){
      const remaining=cap-BigInt(String(observedConfirmed));if(remaining<budget)refuse();
      challenge=await json("/api/session/grant/challenge","POST",{sessAddr:key.address,budgetMicros:String(remaining),recover:true}) as typeof challenge;
    }
    const consent = parseSessionGrantConsent(challenge.consent,profile);
    if (consent.ownerAddr !== context.owner || consent.sessAddr !== key.address!.toLowerCase() || consent.origin !== origin ||
      BigInt(consent.capMicroUsdc)>cap || BigInt(consent.capMicroUsdc)<budget) refuse();
    const signature = await owner.signMessage({message:createSessionGrantConsentMessage(consent,profile)});
    const sessionSignature = await key.signGrantConsentProof(consent,signature);
    await json("/api/session/grant","POST",{consent,signature,sessionSignature});
    let readSource = ports.readSource;
    if (!readSource) {
      const {config} = await import("../lib/config");if(config.profile!==profile)refuse();
      const client=createPublicClient({chain:chainForProfile(profile),transport:attestedArcAuthorityHttp(payment.rpcUrl,{retryCount:0},profile)});
      readSource=async id=>{
        if(!/^0x[0-9a-f]{64}$/.test(id))refuse();
        const source=await client.readContract({address:config.registryReadAddress as Hex,abi:REGISTRY_ABI,functionName:"get",args:[id as Hex]});
        if(/^0x0{40}$/i.test(source.creator)||/^0x0{40}$/i.test(source.payoutWallet)||!source.active||
          source.authors.length<1||source.authors.length>20||source.authors.reduce((n,a)=>n+Number(a.basisPoints),0)!==10000||
          source.authors.some(a=>/^0x0{40}$/i.test(a.wallet)||Number(a.basisPoints)<1)||
          new Set(source.authors.map(a=>a.wallet.toLowerCase())).size!==source.authors.length||source.fetchPriceUsdc6>BigInt(Number.MAX_SAFE_INTEGER))refuse();
        return{creator:source.creator,fetchPayTo:source.payoutWallet.toLowerCase(),wallets:new Set([source.payoutWallet.toLowerCase(),...source.authors.map(a=>a.wallet.toLowerCase())]),
          listPriceUsdc:Number(source.fetchPriceUsdc6)/1e6,onchain:true,active:true};
      };
    }
    const bot=process.env.KERYX_BOT_KEY, askPath=bot?`/api/ask?bot=${encodeURIComponent(bot)}`:"/api/ask";
    const response=await request(askPath,"POST",{question,budget:Number(budget)/1e6,sessionId:context.owner});
    if(!response.body)refuse();
    const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer="",received=0,complete=false;
    try {
      while(!complete){
        const chunk=await reader.read();if(chunk.done)break;received+=chunk.value.length;if(received>16000000)refuse();
        buffer+=decoder.decode(chunk.value,{stream:true});if(buffer.length>2000000)refuse();
        let separator:number;
        while((separator=buffer.indexOf("\n\n"))>=0){
          const block=buffer.slice(0,separator);buffer=buffer.slice(separator+2);
          const lines=block.split("\n"),event=lines.find(l=>l.startsWith("event:"))?.slice(6).trim();
          const raw=lines.filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trim()).join("\n");if(!raw)continue;
          const data=JSON.parse(raw) as {reqId?:unknown;answer?:unknown};
          if(event==="sign-request"){
            if(typeof data.reqId!=="string")refuse();const reqId=data.reqId as string;
            const runtime=createBrowserSessionRuntime(key,{json,readSource:readSource!,reserve:(n,e,nonce,amount,limit,q,original)=>state.reserve(n,e,nonce,amount,limit,q,original)});
            const {paymentHeader}=await runtime.authorizePayment(reqId,questionScope);
            const authorization=JSON.parse(atob(paymentHeader)).authorization as {nonce:string};
            await state.retainHeader(authorization.nonce,paymentHeader);
            await json("/api/ask/sign","POST",{sessionId:context.owner,reqId,paymentHeader});
          }else if(event==="done"){
            complete=true;if(typeof data.answer==="string")console.log(data.answer);
            console.log("Research complete. Original payment attempts remain retained; read-only recovery verifies their status.");
          }else if(event==="error")refuse();
        }
      }
      if(!complete)refuse();
    }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  }finally{key.lock();state.close();}
}
