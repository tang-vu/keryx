import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { RunPrivacyControls } from "./run-privacy-controls";
import { runPrivacyCopy as copy } from "@/locales/en/run-privacy";
import {getDb} from "@/lib/db";
import {privacyReadsActive,requirePrivacy} from "@/lib/run-privacy/contracts";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:copy.metadataTitle,robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function RunPrivacyPage() {
  let admitted=false,active=privacyReadsActive({});try{const db=await getDb();active=privacyReadsActive(db);requirePrivacy(db);admitted=true;}catch{}
  return <><SiteHeader/><main className="mx-auto max-w-[820px] px-4 py-10"><h1 className="font-serif text-2xl">{copy.title}</h1>
    <p className="my-4">{admitted?copy.introduction:active?copy.admission:copy.inactive}</p>
    {admitted&&<RunPrivacyControls/>}</main></>;
}
