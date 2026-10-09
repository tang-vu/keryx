import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import copy from "@/locales/en/bibliographies.json";
import { BibliographiesView } from "./bibliographies-view";
export const metadata: Metadata = { title: copy.pageTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function BibliographiesPage() {
  return <><SiteHeader /><main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
    <h1 className="font-serif text-2xl text-ink">{copy.heading}</h1>
    <p className="mt-2 mb-6 font-serif text-sm text-ink-3">{copy.intro}</p>
    <BibliographiesView />
  </main></>;
}
