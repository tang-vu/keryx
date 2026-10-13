"use client";
import { useEffect, useRef, useState } from "react";
import { runPrivacyCopy as copy } from "@/locales/en/run-privacy";
type Visibility="private"|"unlisted"|"public";
type Snapshot={wallet:string;state:{visibility:Visibility;revision:number;erased:boolean};run:{id:string;question:string}};
const choices:Visibility[]=["private","unlisted","public"];
function ownerDefaults(data:unknown):{wallet:string;visibility:Visibility} {
  if(!data||typeof data!=="object"||!("wallet" in data)||typeof data.wallet!=="string"||!/^0x[a-f0-9]{40}$/.test(data.wallet)
    ||!("visibility" in data)||!choices.includes(data.visibility as Visibility))throw new Error(copy.retry);
  return data as {wallet:string;visibility:Visibility};
}
const button="border border-line px-3 py-2 disabled:opacity-50";
export function RunPrivacyControls() {
  const [wallet,setWallet]=useState(""),[id,setId]=useState(""),[defaults,setDefaults]=useState<Visibility>("private"),[visibility,setVisibility]=useState<Visibility>("private");
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[confirmErase,setConfirmErase]=useState(false);
  const generation=useRef(0), pending=useRef<{key:string;id:string}|null>(null);
  async function request(path:string,init:RequestInit={},expected=wallet) {
    const headers=new Headers(init.headers);if(expected)headers.set("X-Keryx-Expected-Wallet",expected);
    const response=await fetch(path,{...init,headers,credentials:"same-origin",mode:"same-origin",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(response.redirected||(response.url&&response.url!==new URL(path,window.location.href).href))throw new Error(copy.accountChanged);
    if(!response.ok) {const data=await response.json().catch(()=>({}));throw new Error(data.error==="retention_hold"?copy.retention:response.status===401?copy.signIn:response.status===503?copy.admission:copy.retry);}
    return response;
  }
  useEffect(()=>{
    let live=true,channel:BroadcastChannel|null=null;
    const refresh=async(stamp:number)=>{
      try {const response=await request("/api/me/run-privacy/default",{},"");if(!live||stamp!==generation.current)return;
        const data=await response.json();if(!live||stamp!==generation.current)return;const context=ownerDefaults(data);
        setWallet(context.wallet);setDefaults(context.visibility);setNotice("");
      }catch(error){if(live&&stamp===generation.current)setNotice((error as Error).message);}
    };
    const clear=(detail?:unknown)=>{if(!live)return;const stamp=++generation.current;pending.current=null;setSnapshot(null);setWallet("");setId("");setDefaults("private");setVisibility("private");setConfirmErase(false);setBusy(false);
      if(detail==="signed-out")setNotice(copy.signIn);
      else {setNotice(copy.accountChanged);void refresh(stamp);}
    };
    const changed=(event:Event)=>clear((event as CustomEvent).detail),focused=()=>clear();
    const selected=new URLSearchParams(window.location.search).get("run");if(selected&&/^[A-Za-z0-9_-]{1,128}$/.test(selected))setId(selected);
    window.addEventListener("keryx:auth",changed);window.addEventListener("focus",focused);
    try {channel=new BroadcastChannel("keryx-auth-v1");channel.onmessage=event=>clear(event.data);}
    catch { /* As in useSiweAuth, focus refresh covers browsers without messaging. */ }
    void refresh(generation.current);
    return()=>{live=false;generation.current++;window.removeEventListener("keryx:auth",changed);window.removeEventListener("focus",focused);channel?.close();};
  // Clear at the canonical auth notification/focus boundary, before fetching defaults.
  // Only defaults are refreshed; run access still requires an owner action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function load() {
    if(!wallet||busy)return;
    const stamp=generation.current;setBusy(true);setSnapshot(null);setConfirmErase(false);
    try {const response=await request(`/api/me/run-privacy/${encodeURIComponent(id)}`);if(stamp!==generation.current)return;const data=await response.json();
      if(stamp!==generation.current)return;if(data.wallet!==wallet)throw new Error(copy.accountChanged);
      setSnapshot(data);setVisibility(data.state.visibility);setNotice("");pending.current=null;
    }catch(error){if(stamp===generation.current)setNotice((error as Error).message);}finally{if(stamp===generation.current)setBusy(false);}
  }
  async function action(kind:"default"|"visibility"|"erase"|"export") {
    if(!wallet||busy||(kind!=="default"&&!snapshot))return;
    const stamp=generation.current, key=JSON.stringify({kind,id,revision:snapshot?.state.revision,visibility,defaults});
    if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};const requestId=pending.current.id;
    setBusy(true);setNotice("");
    try {
      const path=kind==="default"?"/api/me/run-privacy/default":`/api/me/run-privacy/${encodeURIComponent(id)}${kind==="export"?"/export":""}`;
      const response=await request(path,kind==="export"?{headers:{"X-Keryx-Request-Id":requestId}}:{method:kind==="erase"?"DELETE":"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(kind==="default"?{visibility:defaults,requestId}:{revision:snapshot!.state.revision,requestId,...(kind==="visibility"?{visibility}:{})})});
      if(stamp!==generation.current)return;
      if(kind==="export") {const blob=await response.blob();if(stamp!==generation.current)return;const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`keryx-owner-${id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      else {const data=await response.json();if(stamp!==generation.current)return;
        if(kind==="default") {const context=ownerDefaults(data);if(context.wallet!==wallet||context.visibility!==defaults)throw new Error(copy.accountChanged);}
        else {setSnapshot({...snapshot!,state:data,run:kind==="erase"?{...snapshot!.run,question:""}:snapshot!.run});setConfirmErase(false);}
      }
      if(stamp!==generation.current)return;pending.current=null;setNotice(kind==="erase"?copy.erased:copy.saved);
    }catch(error){if(stamp===generation.current)setNotice((error as Error).message);}finally{if(stamp===generation.current)setBusy(false);}
  }
  return <div className="space-y-6"><p role="status">{notice}</p>
    <fieldset disabled={busy||!wallet} className="space-x-3"><label>{copy.defaultLabel} <select value={defaults} onChange={event=>setDefaults(event.target.value as Visibility)}>{choices.map(value=><option key={value} value={value}>{copy.choices[value]}</option>)}</select></label><button className={button} onClick={()=>void action("default")}>{copy.saveDefault}</button></fieldset>
    <fieldset disabled={busy||!wallet} className="space-x-3"><label>{copy.runId} <input value={id} onChange={event=>{setId(event.target.value);setSnapshot(null);setConfirmErase(false);}} className="border border-line p-2"/></label><button className={button} onClick={()=>void load()}>{copy.load}</button></fieldset>
    {snapshot&&<fieldset disabled={busy} className="space-y-4"><p>{snapshot.state.erased?copy.erasedLabel:snapshot.run.question}</p>
      {!snapshot.state.erased&&<div className="space-x-3"><label>{copy.visibility} <select value={visibility} onChange={event=>setVisibility(event.target.value as Visibility)}>{choices.map(value=><option key={value} value={value}>{copy.choices[value]}</option>)}</select></label><button className={button} onClick={()=>void action("visibility")}>{copy.saveVisibility}</button></div>}
      <button className={button} onClick={()=>void action("export")}>{copy.export}</button>
      {!snapshot.state.erased&&<div><p>{copy.eraseExplanation}</p>
        <label><input type="checkbox" checked={confirmErase} onChange={event=>setConfirmErase(event.target.checked)}/> {copy.eraseConsent}</label>
        <button className={button} disabled={!confirmErase} onClick={()=>void action("erase")}>{copy.erase}</button></div>}
    </fieldset>}
  </div>;
}
