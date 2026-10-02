"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { formatUnits,parseUnits,type Hex,type PublicClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "@/lib/arc-network-profile";
import { listWithdrawalBrowserJournals,readWithdrawalBrowserJournal } from "@/lib/gateway/withdrawal-browser-journal";
import { prepareCreatorOwnerBrowserWithdrawal,signCreatorOwnerBrowserWithdrawal,submitCreatorOwnerBrowserWithdrawal,
  recoverCreatorOwnerBrowserWithdrawal,mintCreatorOwnerBrowserWithdrawal,completeCreatorOwnerBrowserWithdrawal,
  type CreatorOwnerReview } from "@/lib/gateway/creator-owner-browser-client";

type Row=Awaited<ReturnType<typeof readWithdrawalBrowserJournal>>;
const button="border border-ink px-3 py-2 font-mono text-xs disabled:opacity-40";
function micros(input:string,positive=false){if(!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(input))throw new Error("Enter USDC with at most six decimals");
  const value=parseUnits(input,6);if(value>BigInt(Number.MAX_SAFE_INTEGER)||(positive&&value<=BigInt(0)))throw new Error("Choose a supported positive amount");return value.toString()}

/** Ordinary creator owner wallet cashout. All actions retain the original journal;
 * no treasury gas, automatic transfer retry or session wallet transaction authority. */
export function CreatorOwnerWithdrawalPanel({address}:{address:string}){
  return <CreatorOwner key={address.toLowerCase()} owner={address.toLowerCase()}/>;
}
function CreatorOwner({owner}:{owner:string}){
  const {data:wallet}=useWalletClient(),rpc=usePublicClient({chainId:profile.chainId});
  const [amount,setAmount]=useState(""),[fee,setFee]=useState(""),[id,setId]=useState(""),[hash,setHash]=useState("");
  const [row,setRow]=useState<Row|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [references,setReferences]=useState<Array<{id:string;state:string;mintHash?:string}>>([]);
  const active=useRef<AbortController|null>(null),ownerRef=useRef(owner),mounted=useRef(true);
  const generation=useRef(0);
  const connectedOwner=wallet?.account.address.toLowerCase()===owner?owner:"";
  useLayoutEffect(()=>{ownerRef.current=connectedOwner;const registration=generation;
    return()=>{registration.current++;active.current?.abort();ownerRef.current=""};
  },[connectedOwner]);
  useEffect(()=>{mounted.current=true;const registration=generation;
    const signedOut=(event:Event)=>{if((event as CustomEvent).detail==="signed-out"){registration.current++;active.current?.abort();setBusy(false);setMessage("Sign in as the original creator to continue recovery")}};
    window.addEventListener("keryx:auth",signedOut);
    return()=>{mounted.current=false;registration.current++;active.current?.abort();window.removeEventListener("keryx:auth",signedOut)};
  },[]);
  useEffect(()=>{let live=true;void listWithdrawalBrowserJournals(owner).then(result=>{if(live)setReferences(result.requests.map(r=>({id:r.id,state:r.state,...(r.mint?.hash?{mintHash:r.mint.hash}:{})})))}).catch(()=>{if(live)setReferences([])});
    return()=>{live=false};
  },[owner,row]);
  const perform=async(work:(current:()=>string|null,signal:AbortSignal)=>Promise<void>)=>{
    if(active.current)return;const controller=new AbortController(),expected=++generation.current;active.current=controller;
    const current=()=>mounted.current&&generation.current===expected&&!controller.signal.aborted?ownerRef.current:null;
    setBusy(true);setMessage("");
    try{if(current()!==owner)throw new Error("Connect the original creator wallet");await work(current,controller.signal)}
    catch(err){if(current()===owner)setMessage(err instanceof Error?err.message:"Original creator withdrawal unavailable")}
    finally{if(active.current===controller){active.current=null;if(mounted.current)setBusy(false)}}
  };
  const checkedReview=():CreatorOwnerReview=>({amountMicroUsdc:micros(amount,true),maxFeeMicroUsdc:micros(fee)});
  const refresh=async(selected:string,current:()=>string|null,signal:AbortSignal)=>{
    const original=await readWithdrawalBrowserJournal(selected,owner);signal.throwIfAborted();if(current()!==owner)throw new Error("Creator owner changed");
    setRow(original);setId(original.id);if(original.mint?.hash)setHash(original.mint.hash);return original;
  };
  const prepare=()=>perform(async(current,signal)=>{const original=await prepareCreatorOwnerBrowserWithdrawal(owner,checkedReview(),current,signal);
    setRow(original);setId(original.id);setHash("");setMessage("Unsigned original saved. Review its amount, fee and recipient before signing.")});
  const sign=()=>perform(async(current,signal)=>{if(!wallet)throw new Error("Creator wallet unavailable");
    await signCreatorOwnerBrowserWithdrawal(id,owner,checkedReview(),wallet,current,signal);await refresh(id,current,signal);setMessage("Original burn signature saved; sending remains a separate step.")});
  const submit=()=>perform(async(current,signal)=>{await submitCreatorOwnerBrowserWithdrawal(id,owner,current,signal);await refresh(id,current,signal);
    setMessage("Original transfer attempt retained. Read its recovery status; do not send another burn.")});
  const recover=()=>perform(async(current,signal)=>{await refresh(id,current,signal);const result=await recoverCreatorOwnerBrowserWithdrawal(id,owner,current,signal);
    setMessage(result.completion?"Original owner mint finality verified":"Transfer pending: "+result.progress.status)});
  const mint=()=>perform(async(current,signal)=>{if(!wallet||!rpc)throw new Error("Original creator wallet and gas RPC unavailable");
    const result=await mintCreatorOwnerBrowserWithdrawal(id,owner,wallet,rpc as PublicClient,current,signal);setHash(result.transactionHash);
    await refresh(id,current,signal);setMessage("Owner mint submitted; original finality remains pending.")});
  const complete=()=>perform(async(current,signal)=>{if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error("Enter the original owner mint transaction hash");
    await completeCreatorOwnerBrowserWithdrawal(id,owner,hash.toLowerCase() as Hex,current,signal);await refresh(id,current,signal);setMessage("Original owner mint finality verified")});
  return <section className="mb-4 space-y-3 border border-ink bg-paper p-5" aria-label="Creator owner withdrawal">
    <h2 className="font-display text-xl">Withdraw creator earnings</h2>
    <p className="text-sm">Arc mainnet USDC returns to your connected creator wallet. Review the Circle fee, then sign and send the original burn. Minting needs a separate owner wallet transaction and native gas.</p>
    <div className="flex flex-wrap gap-3"><label>Amount USDC <input aria-label="Creator withdrawal amount" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)} className="w-28 border border-rule p-1"/></label>
      <label>Maximum fee USDC <input aria-label="Creator withdrawal maximum fee" value={fee} disabled={busy} onChange={e=>setFee(e.target.value)} className="w-28 border border-rule p-1"/></label></div>
    <button className={button} disabled={busy} onClick={prepare}>Prepare creator withdrawal</button>
    {references.length>0&&<label className="block">Saved originals <select aria-label="Saved creator withdrawals" disabled={busy} value={references.some(r=>r.id===id)?id:""} onChange={e=>{setId(e.target.value);setRow(null);setHash(references.find(r=>r.id===e.target.value)?.mintHash??"")}} className="max-w-full border p-1">
      <option value="">Choose an original</option>{references.map(r=><option key={r.id} value={r.id}>{r.id} - {r.state}</option>)}</select></label>}
    <label className="block">Original request <input aria-label="Original creator withdrawal request" value={id} disabled={busy} onChange={e=>{setId(e.target.value);setRow(null);setHash("")}} className="w-full border p-1 font-mono text-xs"/></label>
    {row&&<p className="text-sm">Amount {formatUnits(BigInt(row.draft.burnIntent.spec.value),6)} USDC, fee at most {formatUnits(BigInt(row.draft.burnIntent.maxFee),6)} USDC; recipient {row.owner}.</p>}
    <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||row?.state!=="reserved"} onClick={sign}>Sign reviewed creator burn</button>
      <button className={button} disabled={busy||row?.state!=="signed"} onClick={submit}>Send signed creator burn</button>
      <button className={button} disabled={busy||!id} onClick={recover}>Read creator recovery</button>
      <button className={button} disabled={busy||!row?.request||!!row.mint} onClick={mint}>Review creator mint and gas</button></div>
    <label className="block">Original owner mint hash <input aria-label="Original creator mint hash" value={hash} disabled={busy} onChange={e=>setHash(e.target.value)} className="w-full border p-1 font-mono text-xs"/></label>
    <button className={button} disabled={busy||!id||!hash} onClick={complete}>Verify creator mint finality</button>
    <p className="text-xs">A lost response or interrupted wallet prompt retains the original attempt. Saved requests can be read after reload; browser data loss does not grant retry permission. Keep wallet transaction hashes for recovery.</p>
    <p role="status" aria-label="Creator withdrawal status">{message}</p>
  </section>;
}
