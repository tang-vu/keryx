"use client";
import Link from "next/link";
import { publicProfileCopy as copy } from "@/locales/en/public-profiles";
import { useEffect,useRef,useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { PUBLIC_PROFILE_FIELDS,publicProfileInput,publicProfileSettings,type PublicProfileSettings } from "@/lib/profiles/public-profile";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_copy = copy;

const labels=copy.fields;
export function PublicProfileEditor(){
  const copy = useUiCopy("public-profiles", uiEnglish_copy);const {session}=useSiweAuth();
  if(session===undefined)return <p role="status" className="mt-6">{copy.checking}</p>;
  if(!session)return <p className="mt-6"><Link className="underline" href="/connect">{copy.signIn}</Link> {copy.signInPurpose}</p>;
  return <Editor key={session.address.toLowerCase()} wallet={session.address.toLowerCase()}/>;
}
function Editor({wallet}:{wallet:string}){
  const copy = useUiCopy("public-profiles", uiEnglish_copy);
  const [settings,setSettings]=useState<PublicProfileSettings|null>(null),[fields,setFields]=useState<Array<typeof PUBLIC_PROFILE_FIELDS[number]>>([]),[ids,setIds]=useState("");
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>{const owned=new AbortController();controller.current=owned;
    fetch("/api/me/public-profile",{cache:"no-store",headers:{"X-Keryx-Expected-Wallet":wallet},signal:AbortSignal.any([owned.signal,AbortSignal.timeout(10000)])})
      .then(async response=>{if(!response.ok)throw new Error(copy.unavailable);const value=publicProfileSettings.parse(await response.json());
        if(!owned.signal.aborted){setSettings(value);setFields(value.fields);setIds(value.runIds.join("\n"));}})
      .catch(error=>{if(!owned.signal.aborted)setMessage(error instanceof Error?error.message:copy.profileUnavailable);});
    return ()=>owned.abort();
  },[wallet]);
  const save=async(unpublish=false)=>{const owned=controller.current;if(busy||!settings||!owned||owned.signal.aborted)return;
    const input=publicProfileInput.safeParse({published:true,fields,runIds:ids.split(/\s+/).filter(Boolean),revision:settings.revision});
    if(!unpublish&&!input.success){setMessage(copy.invalidSelection);return;}
    setBusy(true);setMessage("");try{
      const response=await fetch("/api/me/public-profile",{method:unpublish?"DELETE":"PUT",headers:{"Content-Type":"application/json","X-Keryx-Expected-Wallet":wallet},
        ...(!unpublish&&input.success?{body:JSON.stringify(input.data)}:{}),signal:AbortSignal.any([owned.signal,AbortSignal.timeout(10000)])});
      if(!response.ok)throw new Error(response.status===409?copy.changed:response.status===403?copy.notOwned:copy.unconfirmed);
      const value=await response.json();if(owned.signal.aborted)return;
      if(unpublish){setSettings({...settings,published:false,revision:Math.min(settings.revision+1,2147483647)});setMessage(copy.unpublishedNotice);}
      else{setSettings(publicProfileSettings.parse(value));setMessage(copy.publishedNotice);}
    }catch(error){if(!owned.signal.aborted)setMessage(error instanceof Error?error.message:copy.unconfirmedNotice);}
    finally{if(!owned.signal.aborted)setBusy(false);}
  };
  return <section className="mt-6 space-y-4" aria-label={copy.publication}>
    {message&&<p role="status">{message}</p>}
    {settings&&<><p className="break-all">{copy.handle} {settings.handle?`@${settings.handle}`:copy.missingHandle} · {settings.published?copy.published:copy.unpublished}</p>
      <fieldset className="space-y-3"><legend className="mb-2 font-semibold">{copy.fieldsLegend}</legend>{PUBLIC_PROFILE_FIELDS.map(field=><label className="flex items-start gap-3" key={field}>
        <input type="checkbox" checked={fields.includes(field)} disabled={busy} onChange={event=>setFields(current=>event.target.checked?[...current,field]:current.filter(value=>value!==field))}/>{labels[field]}</label>)}</fieldset>
      <p className="text-sm">{copy.ledgerConsent}</p>
      <label className="block">{copy.selectedIds}<textarea className="mt-2 block w-full min-h-32 border border-line bg-paper p-3 font-mono text-sm" value={ids} onChange={event=>setIds(event.target.value)} maxLength={6500} disabled={busy}/></label>
      <p className="text-sm">{copy.publicationBoundary}</p>
      <div className="flex flex-wrap gap-3"><button className="border border-ink bg-ink px-4 py-2 text-paper" disabled={busy||!settings.handle} onClick={()=>{void save();}}>{busy?copy.saving:settings.published?copy.updateSelection:copy.publish}</button>
        <button className="border border-line px-4 py-2" disabled={busy||!settings.published} onClick={()=>{void save(true);}}>{copy.unpublish}</button>
        {settings.published&&<Link className="underline self-center" href={`/u/${settings.handle}`}>{copy.viewPublic}</Link>}</div>
    </>}
  </section>;
}
