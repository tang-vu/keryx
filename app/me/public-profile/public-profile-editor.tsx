"use client";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { PUBLIC_PROFILE_FIELDS,publicProfileInput,publicProfileSettings,type PublicProfileSettings } from "@/lib/profiles/public-profile";
const labels={displayName:"Display name",about:"About",purpose:"Research purpose",verifiedLinks:"Verified account links",ledgers:"Wallet-wide settled creator ledger totals"};
export function PublicProfileEditor(){const {session}=useSiweAuth();
  if(session===undefined)return <p role="status" className="mt-6">Checking sign-in…</p>;
  if(!session)return <p className="mt-6"><Link className="underline" href="/connect">Sign in with your wallet</Link> to control publication.</p>;
  return <Editor key={session.address.toLowerCase()} wallet={session.address.toLowerCase()}/>;
}
function Editor({wallet}:{wallet:string}){
  const [settings,setSettings]=useState<PublicProfileSettings|null>(null),[fields,setFields]=useState<Array<typeof PUBLIC_PROFILE_FIELDS[number]>>([]),[ids,setIds]=useState("");
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>{const owned=new AbortController();controller.current=owned;
    fetch("/api/me/public-profile",{cache:"no-store",headers:{"X-Keryx-Expected-Wallet":wallet},signal:AbortSignal.any([owned.signal,AbortSignal.timeout(10000)])})
      .then(async response=>{if(!response.ok)throw new Error("Public profile publishing is unavailable for this account.");const value=publicProfileSettings.parse(await response.json());
        if(!owned.signal.aborted){setSettings(value);setFields(value.fields);setIds(value.runIds.join("\n"));}})
      .catch(error=>{if(!owned.signal.aborted)setMessage(error instanceof Error?error.message:"Profile unavailable.");});
    return ()=>owned.abort();
  },[wallet]);
  const save=async(unpublish=false)=>{const owned=controller.current;if(busy||!settings||!owned||owned.signal.aborted)return;
    const input=publicProfileInput.safeParse({published:true,fields,runIds:ids.split(/\s+/).filter(Boolean),revision:settings.revision});
    if(!unpublish&&!input.success){setMessage("Choose at most 50 unique run IDs and valid fields.");return;}
    setBusy(true);setMessage("");try{
      const response=await fetch("/api/me/public-profile",{method:unpublish?"DELETE":"PUT",headers:{"Content-Type":"application/json","X-Keryx-Expected-Wallet":wallet},
        ...(!unpublish&&input.success?{body:JSON.stringify(input.data)}:{}),signal:AbortSignal.any([owned.signal,AbortSignal.timeout(10000)])});
      if(!response.ok)throw new Error(response.status===409?"The profile changed. Reload before publishing.":response.status===403?"One or more runs lack your ownership proof.":"Publication could not be confirmed. Inspect the profile before trying again.");
      const value=await response.json();if(owned.signal.aborted)return;
      if(unpublish){setSettings({...settings,published:false,revision:Math.min(settings.revision+1,2147483647)});setMessage("Unpublished. The page, JSON and sitemap no longer list your profile.");}
      else{setSettings(publicProfileSettings.parse(value));setMessage("Published. Only selected fields and PUBLIC owned runs are visible.");}
    }catch(error){if(!owned.signal.aborted)setMessage(error instanceof Error?error.message:"Publication unconfirmed.");}
    finally{if(!owned.signal.aborted)setBusy(false);}
  };
  return <section className="mt-6 space-y-4" aria-label="Profile publication">
    {message&&<p role="status">{message}</p>}
    {settings&&<><p className="break-all">Handle: {settings.handle?`@${settings.handle}`:"Save a handle in your private profile first."} · {settings.published?"Published":"Not published"}</p>
      <fieldset className="space-y-3"><legend className="mb-2 font-semibold">Fields to publish</legend>{PUBLIC_PROFILE_FIELDS.map(field=><label className="flex items-start gap-3" key={field}>
        <input type="checkbox" checked={fields.includes(field)} disabled={busy} onChange={event=>setFields(current=>event.target.checked?[...current,field]:current.filter(value=>value!==field))}/>{labels[field]}</label>)}</fieldset>
      <p className="text-sm">Ledger totals cover the wallet&apos;s recorded settled creator events, including amounts associated with private runs without exposing their identifiers. Treasury sponsorship is separate. Do not select this field unless you want those aggregate amounts public.</p>
      <label className="block">Selected owned run IDs (one per line, at most 50)<textarea className="mt-2 block w-full min-h-32 border border-line bg-paper p-3 font-mono text-sm" value={ids} onChange={event=>setIds(event.target.value)} maxLength={6500} disabled={busy}/></label>
      <p className="text-sm">Publication never makes a run PUBLIC. Change visibility separately. Private, unlisted, erased and no-longer-owned runs remain absent.</p>
      <div className="flex flex-wrap gap-3"><button className="border border-ink bg-ink px-4 py-2 text-paper" disabled={busy||!settings.handle} onClick={()=>{void save();}}>{busy?"Saving…":settings.published?"Update published selection":"Publish profile"}</button>
        <button className="border border-line px-4 py-2" disabled={busy||!settings.published} onClick={()=>{void save(true);}}>Unpublish</button>
        {settings.published&&<Link className="underline self-center" href={`/u/${settings.handle}`}>View public profile</Link>}</div>
    </>}
  </section>;
}
