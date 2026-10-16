import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SpecialistBriefBuilder } from "@/components/keryx/specialist-brief-builder";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { specialistBriefCopy as copy } from "@/locales/en/specialist-briefs";
import { UiText } from "@/lib/i18n/ui-copy";



export const metadata: Metadata = { title: copy.metadataTitle, description: copy.description,
  alternates: englishPublicAlternates("/briefs"),
  openGraph: { title: copy.metadataTitle, description: copy.description, url: "/briefs" } };

export default function BriefsPage() {
  return <div className="min-h-screen bg-paper-2">
    <SiteHeader />
    <main className="mx-auto max-w-[1080px] px-4 py-12 sm:px-[30px]">
      <p className="font-mono text-xs uppercase tracking-widest text-seal"><UiText source={copy.kicker} namespaces={["specialist-briefs"]} /></p>
      <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl"><UiText source={copy.title} namespaces={["specialist-briefs"]} /></h1>
      <p className="mt-5 max-w-[76ch] font-serif text-lg leading-relaxed text-ink-2"><UiText source={copy.introduction} namespaces={["specialist-briefs"]} /></p>
      <p className="mt-3 max-w-[80ch] font-serif text-sm text-ink-3"><UiText source={copy.scopeNotice} namespaces={["specialist-briefs"]} /></p>
      <SpecialistBriefBuilder />
      <aside className="mt-10 border-t border-line pt-6">
        <h2 className="font-display text-2xl"><UiText source={copy.pricingTitle} namespaces={["specialist-briefs"]} /></h2>
        <p className="mt-3 max-w-[80ch] font-serif leading-relaxed text-ink-2"><UiText source={copy.pricingBody} namespaces={["specialist-briefs"]} /></p>
        <Link href="/pricing" className="mt-3 inline-flex min-h-11 items-center font-mono text-sm text-paid underline underline-offset-4"><UiText source={copy.pricingAction} namespaces={["specialist-briefs"]} /></Link>
      </aside>
    </main>
    <SiteFooter />
  </div>;
}
