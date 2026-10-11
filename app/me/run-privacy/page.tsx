import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { RunPrivacyControls } from "./run-privacy-controls";
import { runPrivacyCopy as copy } from "@/locales/en/run-privacy";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:copy.metadataTitle,robots:{index:false,follow:false},referrer:"no-referrer"};
export default function RunPrivacyPage() {
  return <><SiteHeader/><main className="mx-auto max-w-[820px] px-4 py-10"><h1 className="font-serif text-2xl">{copy.title}</h1>
    <p className="my-4">{copy.introduction}</p>
    <RunPrivacyControls/></main></>;
}
