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

function atomic(value:string,positive=false){
  if(!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value))throw new Error("Enter USDC with at most six decimals");
  const [whole,fraction=""]=value.split("."),amount=BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,"0"));
  if(amount>BigInt(Number.MAX_SAFE_INTEGER)||(positive&&amount===BigInt(0)))throw new Error("Choose a supported positive amount");
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
  useEffect(()=>{const changed=(event:Event)=>{if((event as CustomEvent).detail==="signed-out"){generation.current++;setBusy(false);setError("Sign in as the original owner to recover cashout")}};
    window.addEventListener("keryx:auth",changed);return()=>window.removeEventListener("keryx:auth",changed)},[]);
  useEffect(()=>{if(!open||!owner)return;let active=true;
    void listBrowserSessionWithdrawalReferences(browserSessionCustodyContext(profile,window.location.origin,owner).storageNamespace)
      .then(rows=>{if(active)setReferences(rows)}).catch(()=>{if(active)setReferences([])});
    return()=>{active=false};
  },[owner,open,status]);
  const action=async(work:(current:()=>void,originalOwner:string)=>Promise<void>)=>{
    const selected=ownerRef.current,expected=++generation.current;if(!selected){setError("Connect the original owner wallet");return}
    const current=()=>{if(generation.current!==expected||ownerRef.current!==selected)throw new Error("Cashout owner changed")};
    setBusy(true);setError(null);
    try{await work(current,selected)}catch(err){if(generation.current===expected)setError(err instanceof Error?err.message:"Original cashout unavailable")}
    finally{if(generation.current===expected)setBusy(false)}
  };
  const restore=async(originalOwner:string)=>{const signer=getSessionSigner();await signer.restoreRetained(originalOwner);return signer};
  const prepare=()=>action(async(current,originalOwner)=>{
    const amountMicros=atomic(amount,true),maxFeeMicros=atomic(fee),signer=await restore(originalOwner);current();
    const address=signer.sessionAddress?.toLowerCase();if(!address||(sessAddr&&address!==sessAddr.toLowerCase()))throw new Error("Original retained signer differs");
    const epoch=readRetainedSessionGrantReference(originalOwner,address);if(!epoch)throw new Error("Retained owner consent reference unavailable");
    const p=await verifySessionWithdrawalPreparation(await sessionJson("/api/session/withdraw/prepare","POST",{sessAddr:address,grantEpoch:epoch,amountMicros}));current();
    if(p.ownerAddr!==originalOwner||p.sessAddr!==address||p.authorization.consent.origin!==window.location.origin)throw new Error("Original cashout identity differs");
    setPreparation(p);setId(p.requestId);setStatus("prepared");
    if(p.burnIntent.spec.value!==amountMicros||BigInt(p.burnIntent.maxFee)>BigInt(maxFeeMicros))throw new Error("Prepared amount or fee exceeds your review. Cancel this unsigned original before preparing again.");
  });
  const sign=()=>action(async(current,originalOwner)=>{
    if(!preparation)throw new Error("Read the original cashout first");const signer=await restore(originalOwner);current();
    const result=await signer.signWithdrawal(preparation.requestId,{amountMicroUsdc:atomic(amount,true),maxFeeMicroUsdc:atomic(fee)});current();
    const context=browserSessionCustodyContext(profile,window.location.origin,originalOwner);
    if(!await claimBrowserSessionWithdrawalDelivery(context.storageNamespace,preparation,{submissionPossible:true}))throw new Error("An original transfer attempt exists; use recovery");current();
    // Even a failed HTTP response retains the local claim. Only original status recovery follows.
    await sessionJson("/api/session/withdraw/submit","POST",result);current();setStatus("transfer submitted; original recovery required");
  });
  const recover=()=>action(async(current,originalOwner)=>{
    const signer=await restore(originalOwner);current();
    const body=await sessionJson(`/api/session/withdraw/${id}`) as {preparation:unknown;signingPhase:string;progress:{status:string};completion:unknown};
    const p=await verifySessionWithdrawalPreparation(body.preparation);current();
    if(p.ownerAddr!==originalOwner||p.sessAddr!==signer.sessionAddress?.toLowerCase()||p.authorization.consent.origin!==window.location.origin)throw new Error("Original cashout identity differs");
    setPreparation(p);setStatus(`${body.signingPhase}: ${body.progress.status}`);
    const local=await readBrowserSessionWithdrawal(browserSessionCustodyContext(profile,window.location.origin,originalOwner).storageNamespace,id);current();
    if(local?.mint?.hash)setHash(local.mint.hash);
    if(body.completion){await signer.reconcileWithdrawal(id);current();setStatus("completed with original mainnet mint finality")}
  });
  const cancel=()=>action(async(current,originalOwner)=>{const signer=await restore(originalOwner);current();
    await signer.cancelUnexposedWithdrawal(id);current();setStatus("cancelled before exposure; original ID retained")});
  const abort=()=>action(async(current,originalOwner)=>{const signer=await restore(originalOwner);current();
    await signer.abortWithdrawal(id);current();setStatus("interrupted signing cancelled; original retained. Prepare a new withdrawal or renew your Session to resume research.")});
  const mint=()=>action(async(current,originalOwner)=>{
    if(!preparation||!wallet||!rpc)throw new Error("Original cashout and owner wallet unavailable");
    const body=await sessionJson(`/api/session/withdraw/${preparation.requestId}`) as {attestation:unknown};current();
    const response=await submitBrowserSessionOwnerMint({preparation,attestation:body.attestation,wallet,rpc:rpc as PublicClient,assertCurrent:current});current();
    setHash(response.transactionHash);setStatus("owner mint submitted; finality pending");
  });
  const complete=()=>action(async(current,originalOwner)=>{
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error("Enter the original owner mint transaction hash");
    const signer=await restore(originalOwner);current();await sessionJson("/api/session/withdraw/complete","POST",{requestId:id,transactionHash:hash.toLowerCase()});current();
    await signer.reconcileWithdrawal(id);current();setStatus("completed with original mainnet mint finality");
  });
  return <section className="border border-rule bg-paper px-4 py-3 text-xs text-ink-2">
    <button type="button" onClick={()=>setOpen(v=>!v)} className="underline underline-offset-2">Withdraw retained session funds</button>
    {open&&<div className="mt-3 space-y-3">
      <p>Recipient is your original owner wallet. Research pauses while a withdrawal is unresolved. Signed payments and uncertain transfers remain held; gas is paid separately by your owner wallet. Logout and grant expiry retain this browser&apos;s recovery key.</p>
      <p>If signing was interrupted before a burn signature was saved, cancel interrupted signing to unlock recovery. This also works after the original expires. A saved signature or transfer attempt requires original recovery.</p>
      <div className="flex flex-wrap gap-3"><label>Amount USDC <input aria-label="Session withdrawal amount" value={amount} onChange={e=>setAmount(e.target.value)} className="w-28 border border-rule p-1"/></label>
        <label>Maximum fee USDC <input aria-label="Session withdrawal maximum fee" value={fee} onChange={e=>setFee(e.target.value)} className="w-28 border border-rule p-1"/></label></div>
      <button disabled={busy} onClick={prepare} className="underline">Prepare reviewed amount and fee ceiling</button>
      {references.length>0&&<label className="block">Retained originals <select aria-label="Retained session cashouts" value={references.some(row=>row.requestId===id)?id:""}
        onChange={e=>{setId(e.target.value);setPreparation(null);setHash(references.find(row=>row.requestId===e.target.value)?.mintHash??"")}} className="ml-2 max-w-full border border-rule p-1">
        <option value="">Choose an original</option>{references.map(row=><option key={row.requestId} value={row.requestId}>{row.requestId} — {row.publicationAbort?.pending?"signing cancellation pending":row.publicationAbort?"signing cancelled":row.completed?"completed":row.cancelled?"cancelled":"recovery"}</option>)}
      </select></label>}
      {preparation&&<p>Original amount {Number(preparation.burnIntent.spec.value)/1e6} USDC; fee at most {Number(preparation.burnIntent.maxFee)/1e6} USDC. Recipient {preparation.ownerAddr}. Finite burn height {preparation.burnIntent.maxBlockHeight}.</p>}
      <label className="block">Original request ID <input aria-label="Original session withdrawal request" value={id} onChange={e=>{setId(e.target.value);setPreparation(null)}} className="mt-1 w-full border border-rule p-1 font-mono"/></label>
      <div className="flex flex-wrap gap-3"><button disabled={busy||!preparation} onClick={sign} className="underline">Sign and submit original burn</button>
        <button disabled={busy||!id} onClick={recover} className="underline">Read original recovery</button><button disabled={busy||!id} onClick={cancel} className="underline">Cancel never-exposed preparation</button>
        <button disabled={busy||!id} onClick={abort} className="underline">Cancel interrupted signing</button>
        <button disabled={busy||!preparation} onClick={mint} className="underline">Review owner wallet mint and gas</button></div>
      <label className="block">Original owner mint hash <input aria-label="Original session mint hash" value={hash} onChange={e=>setHash(e.target.value)} className="mt-1 w-full border border-rule p-1 font-mono"/></label>
      <button disabled={busy||!id||!hash} onClick={complete} className="underline">Verify original mint finality</button>
      {status&&<p role="status">{status}</p>}{error&&<p role="alert" className="text-seal">{error}</p>}
    </div>}
  </section>;
}
