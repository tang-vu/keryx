"use client";
import { SigningAmount } from "./signing-amount";
import { formatAmount } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { parseUnits,type Hex,type PublicClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "@/lib/arc-network-profile";
import { listWithdrawalBrowserJournals,readWithdrawalBrowserJournal } from "@/lib/gateway/withdrawal-browser-journal";
import { prepareCreatorOwnerBrowserWithdrawal,signCreatorOwnerBrowserWithdrawal,submitCreatorOwnerBrowserWithdrawal,
  recoverCreatorOwnerBrowserWithdrawal,mintCreatorOwnerBrowserWithdrawal,completeCreatorOwnerBrowserWithdrawal,
  type CreatorOwnerReview } from "@/lib/gateway/creator-owner-browser-client";

const uiCopy = createMessages("en");

type Row=Awaited<ReturnType<typeof readWithdrawalBrowserJournal>>;
const button="border border-ink px-3 py-2 font-mono text-xs disabled:opacity-40";
function micros(input:string,positive=false){if(!/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(input))throw new Error(uiCopy("creatorWithdrawal.precision"));
  const value=parseUnits(input,6);if(value>BigInt(Number.MAX_SAFE_INTEGER)||(positive&&value<=BigInt(0)))throw new Error(uiCopy("creatorWithdrawal.positive"));return value.toString()}

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
    const signedOut=(event:Event)=>{if((event as CustomEvent).detail==="signed-out"){registration.current++;active.current?.abort();setBusy(false);setMessage(uiCopy("creatorWithdrawal.signIn"))}};
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
    try{if(current()!==owner)throw new Error(uiCopy("creatorWithdrawal.connect"));await work(current,controller.signal)}
    catch(err){if(current()===owner)setMessage(err instanceof Error?err.message:uiCopy("creatorWithdrawal.unavailable"))}
    finally{if(active.current===controller){active.current=null;if(mounted.current)setBusy(false)}}
  };
  const checkedReview=():CreatorOwnerReview=>({amountMicroUsdc:micros(amount,true),maxFeeMicroUsdc:micros(fee)});
  const refresh=async(selected:string,current:()=>string|null,signal:AbortSignal)=>{
    const original=await readWithdrawalBrowserJournal(selected,owner);signal.throwIfAborted();if(current()!==owner)throw new Error(uiCopy("creatorWithdrawal.ownerChanged"));
    setRow(original);setId(original.id);if(original.mint?.hash)setHash(original.mint.hash);return original;
  };
  const prepare=()=>perform(async(current,signal)=>{const original=await prepareCreatorOwnerBrowserWithdrawal(owner,checkedReview(),current,signal);
    setRow(original);setId(original.id);setHash("");setMessage(uiCopy("creatorWithdrawal.prepared"))});
  const sign=()=>perform(async(current,signal)=>{if(!wallet)throw new Error(uiCopy("creatorWithdrawal.walletUnavailable"));
    await signCreatorOwnerBrowserWithdrawal(id,owner,checkedReview(),wallet,current,signal);await refresh(id,current,signal);setMessage(uiCopy("creatorWithdrawal.signed"))});
  const submit=()=>perform(async(current,signal)=>{await submitCreatorOwnerBrowserWithdrawal(id,owner,current,signal);await refresh(id,current,signal);
    setMessage(uiCopy("creatorWithdrawal.submitted"))});
  const recover=()=>perform(async(current,signal)=>{await refresh(id,current,signal);const result=await recoverCreatorOwnerBrowserWithdrawal(id,owner,current,signal);
    setMessage(result.completion?uiCopy("creatorWithdrawal.completed"):uiCopy("creatorWithdrawal.pending", { status: result.progress.status }))});
  const mint=()=>perform(async(current,signal)=>{if(!wallet||!rpc)throw new Error(uiCopy("creatorWithdrawal.gasUnavailable"));
    const result=await mintCreatorOwnerBrowserWithdrawal(id,owner,wallet,rpc as PublicClient,current,signal);setHash(result.transactionHash);
    await refresh(id,current,signal);setMessage(uiCopy("creatorWithdrawal.minted"))});
  const complete=()=>perform(async(current,signal)=>{if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error(uiCopy("creatorWithdrawal.hashInvalid"));
    await completeCreatorOwnerBrowserWithdrawal(id,owner,hash.toLowerCase() as Hex,current,signal);await refresh(id,current,signal);setMessage(uiCopy("creatorWithdrawal.completed"))});
  return <section className="mb-4 space-y-3 border border-ink bg-paper p-5" aria-label={uiCopy("creatorWithdrawal.aria")}>
    <h2 className="font-display text-xl">{uiCopy("creatorWithdrawal.title")}</h2>
    <p className="text-sm">{uiCopy("creatorWithdrawal.introduction")}</p>
    <div className="flex flex-wrap gap-3"><label>{uiCopy("creatorWithdrawal.amount")} <input aria-label={uiCopy("creatorWithdrawal.amountAria")} value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)} className="w-28 border border-rule p-1"/></label>
      <label>{uiCopy("creatorWithdrawal.fee")} <input aria-label={uiCopy("creatorWithdrawal.feeAria")} value={fee} disabled={busy} onChange={e=>setFee(e.target.value)} className="w-28 border border-rule p-1"/></label></div>
    <button className={button} disabled={busy} onClick={prepare}>{uiCopy("creatorWithdrawal.prepare")}</button>
    {references.length>0&&<label className="block">{uiCopy("creatorWithdrawal.originals")} <select aria-label={uiCopy("creatorWithdrawal.originalsAria")} disabled={busy} value={references.some(r=>r.id===id)?id:""} onChange={e=>{setId(e.target.value);setRow(null);setHash(references.find(r=>r.id===e.target.value)?.mintHash??"")}} className="max-w-full border p-1">
      <option value="">{uiCopy("creatorWithdrawal.choose")}</option>{references.map(r=><option key={r.id} value={r.id}>{r.id} - {r.state}</option>)}</select></label>}
    <label className="block">{uiCopy("creatorWithdrawal.request")} <input aria-label={uiCopy("creatorWithdrawal.requestAria")} value={id} disabled={busy} onChange={e=>{setId(e.target.value);setRow(null);setHash("")}} className="w-full border p-1 font-mono text-xs"/></label>
    {row&&<p className="text-xs"><SigningAmount micros={row.draft.burnIntent.spec.value} /> · <SigningAmount micros={row.draft.burnIntent.maxFee} /></p>}
    {row&&<p className="text-sm">{uiCopy("creatorWithdrawal.terms", { amount: formatAmount(BigInt(row.draft.burnIntent.spec.value), { minimumFractionDigits: 6, useGrouping: false }), fee: formatAmount(BigInt(row.draft.burnIntent.maxFee), { minimumFractionDigits: 6, useGrouping: false }), recipient: row.owner })}</p>}
    <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||row?.state!=="reserved"} onClick={sign}>{uiCopy("creatorWithdrawal.sign")}</button>
      <button className={button} disabled={busy||row?.state!=="signed"} onClick={submit}>{uiCopy("creatorWithdrawal.send")}</button>
      <button className={button} disabled={busy||!id} onClick={recover}>{uiCopy("creatorWithdrawal.recover")}</button>
      <button className={button} disabled={busy||!row?.request||!!row.mint} onClick={mint}>{uiCopy("creatorWithdrawal.mint")}</button></div>
    <label className="block">{uiCopy("creatorWithdrawal.hash")} <input aria-label={uiCopy("creatorWithdrawal.hashAria")} value={hash} disabled={busy} onChange={e=>setHash(e.target.value)} className="w-full border p-1 font-mono text-xs"/></label>
    <button className={button} disabled={busy||!id||!hash} onClick={complete}>{uiCopy("creatorWithdrawal.complete")}</button>
    <p className="text-xs">{uiCopy("creatorWithdrawal.recoveryBoundary")}</p>
    <p role="status" aria-label={uiCopy("creatorWithdrawal.statusAria")}>{message}</p>
  </section>;
}
