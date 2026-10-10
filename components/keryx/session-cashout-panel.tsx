"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWalletClient, usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "@/lib/arc-network-profile";
import { getSessionSigner } from "@/lib/session/session-signer-client";
import { sessionJson } from "@/lib/session/browser-session-http";
import { browserSessionCustodyContext } from "@/lib/session/browser-session-custody";
import { readRetainedSessionGrantReference } from "@/lib/session/browser-session-grant-reference";
import { verifySessionWithdrawalPreparation, type SessionWithdrawalPreparation } from "@/lib/gateway/session-withdrawal-protocol";
import { readBrowserSessionWithdrawal, claimBrowserSessionWithdrawalDelivery,listBrowserSessionWithdrawalReferences } from "@/lib/session/browser-session-withdrawal-storage";
import { submitBrowserSessionOwnerMint } from "@/lib/session/browser-session-owner-mint";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";

const copy = createMessages("en");
const richCopy = createRichMessages("en");


function atomic(value:string,positive=false){
  if(!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value))throw new Error(copy("sessionCashout.amountPrecision"));
  const [whole,fraction=""]=value.split("."),amount=BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,"0"));
  if(amount>BigInt(Number.MAX_SAFE_INTEGER)||(positive&&amount===BigInt(0)))throw new Error(copy("sessionCashout.positiveAmount"));
  return amount.toString();
}
/** Normal owner-funded session recovery, including expired/revoked payment grants.
 * No session transaction authority or automatic burn/mint retry is exposed. */
export function SessionCashoutPanel({sessAddr}:{sessAddr:string|null}){
  const {data:wallet}=useWalletClient(),rpc=usePublicClient(),owner=wallet?.account?.address.toLowerCase()??null;
  const ownerRef=useRef(owner),generation=useRef(0);
  const [open,setOpen]=useState(false),[amount,setAmount]=useState(""),[fee,setFee]=useState(""),[id,setId]=useState("");
  const [preparation,setPreparation]=useState<SessionWithdrawalPreparation|null>(null),[status,setStatus]=useState(""),[hash,setHash]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [references,setReferences]=useState<Awaited<ReturnType<typeof listBrowserSessionWithdrawalReferences>>>([]);
  useLayoutEffect(()=>{if(ownerRef.current!==owner){generation.current++;setPreparation(null);setStatus("");setHash("");setId("");setBusy(false);setError(null)}
    ownerRef.current=owner;const lifecycle=generation;return()=>{lifecycle.current++}},[owner]);
  useEffect(()=>{const changed=(event:Event)=>{if((event as CustomEvent).detail==="signed-out"){generation.current++;setBusy(false);setError(copy("sessionCashout.signInOriginalOwner"))}};
    window.addEventListener("keryx:auth",changed);return()=>window.removeEventListener("keryx:auth",changed)},[]);
  useEffect(()=>{if(!open||!owner)return;let active=true;
    void listBrowserSessionWithdrawalReferences(browserSessionCustodyContext(profile,window.location.origin,owner).storageNamespace)
      .then(rows=>{if(active)setReferences(rows)}).catch(()=>{if(active)setReferences([])});
    return()=>{active=false};
  },[owner,open,status]);
  const action=async(work:(current:()=>void,originalOwner:string)=>Promise<void>)=>{
    const selected=ownerRef.current,expected=++generation.current;if(!selected){setError(copy("sessionCashout.connectOriginalOwner"));return}
    const current=()=>{if(generation.current!==expected||ownerRef.current!==selected)throw new Error(copy("sessionCashout.ownerChanged"))};
    setBusy(true);setError(null);
    try{await work(current,selected)}catch(err){if(generation.current===expected)setError(err instanceof Error?err.message:copy("sessionCashout.unavailable"))}
    finally{if(generation.current===expected)setBusy(false)}
  };
  const restore=async(originalOwner:string)=>{const signer=getSessionSigner();await signer.restoreRetained(originalOwner);return signer};
  const prepare=()=>action(async(current,originalOwner)=>{
    const amountMicros=atomic(amount,true),maxFeeMicros=atomic(fee),signer=await restore(originalOwner);current();
    const address=signer.sessionAddress?.toLowerCase();if(!address||(sessAddr&&address!==sessAddr.toLowerCase()))throw new Error(copy("sessionCashout.signerMismatch"));
    const epoch=readRetainedSessionGrantReference(originalOwner,address);if(!epoch)throw new Error(copy("sessionCashout.consentUnavailable"));
    const p=await verifySessionWithdrawalPreparation(await sessionJson("/api/session/withdraw/prepare","POST",{sessAddr:address,grantEpoch:epoch,amountMicros}));current();
    if(p.ownerAddr!==originalOwner||p.sessAddr!==address||p.authorization.consent.origin!==window.location.origin)throw new Error(copy("sessionCashout.identityMismatch"));
    setPreparation(p);setId(p.requestId);setStatus(copy("sessionCashout.prepared"));
    if(p.burnIntent.spec.value!==amountMicros||BigInt(p.burnIntent.maxFee)>BigInt(maxFeeMicros))throw new Error(copy("sessionCashout.reviewExceeded"));
  });
  const sign=()=>action(async(current,originalOwner)=>{
    if(!preparation)throw new Error(copy("sessionCashout.readFirst"));const signer=await restore(originalOwner);current();
    const result=await signer.signWithdrawal(preparation.requestId,{amountMicroUsdc:atomic(amount,true),maxFeeMicroUsdc:atomic(fee)});current();
    const context=browserSessionCustodyContext(profile,window.location.origin,originalOwner);
    if(!await claimBrowserSessionWithdrawalDelivery(context.storageNamespace,preparation,{submissionPossible:true}))throw new Error(copy("sessionCashout.attemptExists"));current();
    // Even a failed HTTP response retains the local claim. Only original status recovery follows.
    await sessionJson("/api/session/withdraw/submit","POST",result);current();setStatus(copy("sessionCashout.transferSubmitted"));
  });
  const recover=()=>action(async(current,originalOwner)=>{
    const signer=await restore(originalOwner);current();
    const body=await sessionJson(`/api/session/withdraw/${id}`) as {preparation:unknown;signingPhase:string;progress:{status:string};completion:unknown};
    const p=await verifySessionWithdrawalPreparation(body.preparation);current();
    if(p.ownerAddr!==originalOwner||p.sessAddr!==signer.sessionAddress?.toLowerCase()||p.authorization.consent.origin!==window.location.origin)throw new Error(copy("sessionCashout.identityMismatch"));
    setPreparation(p);setStatus(`${body.signingPhase}: ${body.progress.status}`);
    const local=await readBrowserSessionWithdrawal(browserSessionCustodyContext(profile,window.location.origin,originalOwner).storageNamespace,id);current();
    if(local?.mint?.hash)setHash(local.mint.hash);
    if(body.completion){await signer.reconcileWithdrawal(id);current();setStatus(copy("sessionCashout.completedWithFinality"))}
  });
  const cancel=()=>action(async(current,originalOwner)=>{const signer=await restore(originalOwner);current();
    await signer.cancelUnexposedWithdrawal(id);current();setStatus(copy("sessionCashout.cancelledBeforeExposure"))});
  const abort=()=>action(async(current,originalOwner)=>{const signer=await restore(originalOwner);current();
    await signer.abortWithdrawal(id);current();setStatus(copy("sessionCashout.interruptedSigningCancelled"))});
  const mint=()=>action(async(current,originalOwner)=>{
    if(!preparation||!wallet||!rpc)throw new Error(copy("sessionCashout.walletUnavailable"));
    const body=await sessionJson(`/api/session/withdraw/${preparation.requestId}`) as {attestation:unknown};current();
    const response=await submitBrowserSessionOwnerMint({preparation,attestation:body.attestation,wallet,rpc:rpc as PublicClient,assertCurrent:current});current();
    setHash(response.transactionHash);setStatus(copy("sessionCashout.mintSubmitted"));
  });
  const complete=()=>action(async(current,originalOwner)=>{
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error(copy("sessionCashout.enterMintHash"));
    const signer=await restore(originalOwner);current();await sessionJson("/api/session/withdraw/complete","POST",{requestId:id,transactionHash:hash.toLowerCase()});current();
    await signer.reconcileWithdrawal(id);current();setStatus(copy("sessionCashout.completedWithFinality"));
  });
  return <section className="border border-rule bg-paper px-4 py-3 text-xs text-ink-2">
    <button type="button" onClick={()=>setOpen(v=>!v)} className="underline underline-offset-2">{copy("sessionCashout.withdraw")}</button>
    {open&&<div className="mt-3 space-y-3">
      <p>{copy("sessionCashout.custodyBoundary")}</p>
      <p>{copy("sessionCashout.recoveryBoundary")}</p>
      <div className="flex flex-wrap gap-3"><label>{copy("sessionCashout.amountLabel")}<input aria-label={copy("sessionCashout.amountAria")} value={amount} onChange={e=>setAmount(e.target.value)} className="w-28 border border-rule p-1"/></label>
        <label>{copy("sessionCashout.feeLabel")}<input aria-label={copy("sessionCashout.feeAria")} value={fee} onChange={e=>setFee(e.target.value)} className="w-28 border border-rule p-1"/></label></div>
      <button disabled={busy} onClick={prepare} className="underline">{copy("sessionCashout.prepare")}</button>
      {references.length>0&&<label className="block">{copy("sessionCashout.originals")}<select aria-label={copy("sessionCashout.originalsAria")} value={references.some(row=>row.requestId===id)?id:""}
        onChange={e=>{setId(e.target.value);setPreparation(null);setHash(references.find(row=>row.requestId===e.target.value)?.mintHash??"")}} className="ml-2 max-w-full border border-rule p-1">
        <option value="">{copy("sessionCashout.chooseOriginal")}</option>{references.map(row=><option key={row.requestId} value={row.requestId}>{row.requestId} — {row.publicationAbort?.pending?copy("sessionCashout.signingCancellationPending"):row.publicationAbort?copy("sessionCashout.signingCancelled"):row.completed?copy("sessionCashout.completed"):row.cancelled?copy("sessionCashout.cancelled"):copy("sessionCashout.recovery")}</option>)}
      </select></label>}
      {preparation&&<p>{richCopy("sessionCashout.preparation", { amount: Number(preparation.burnIntent.spec.value)/1e6, fee: Number(preparation.burnIntent.maxFee)/1e6, recipient: preparation.ownerAddr, height: preparation.burnIntent.maxBlockHeight })}</p>}
      <label className="block">{copy("sessionCashout.requestIdLabel")}<input aria-label={copy("sessionCashout.requestIdAria")} value={id} onChange={e=>{setId(e.target.value);setPreparation(null)}} className="mt-1 w-full border border-rule p-1 font-mono"/></label>
      <div className="flex flex-wrap gap-3"><button disabled={busy||!preparation} onClick={sign} className="underline">{copy("sessionCashout.signBurn")}</button>
        <button disabled={busy||!id} onClick={recover} className="underline">{copy("sessionCashout.readRecovery")}</button><button disabled={busy||!id} onClick={cancel} className="underline">{copy("sessionCashout.cancelUnexposed")}</button>
        <button disabled={busy||!id} onClick={abort} className="underline">{copy("sessionCashout.cancelInterrupted")}</button>
        <button disabled={busy||!preparation} onClick={mint} className="underline">{copy("sessionCashout.reviewMint")}</button></div>
      <label className="block">{copy("sessionCashout.mintHashLabel")}<input aria-label={copy("sessionCashout.mintHashAria")} value={hash} onChange={e=>setHash(e.target.value)} className="mt-1 w-full border border-rule p-1 font-mono"/></label>
      <button disabled={busy||!id||!hash} onClick={complete} className="underline">{copy("sessionCashout.verifyMint")}</button>
      {status&&<p role="status">{status}</p>}{error&&<p role="alert" className="text-seal">{error}</p>}
    </div>}
  </section>;
}
