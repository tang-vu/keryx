import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SpecialistBriefBuilder } from "@/components/keryx/specialist-brief-builder";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { specialistBriefCopy as copy } from "@/locales/en/specialist-briefs";

export const metadata: Metadata = { title: copy.metadataTitle, description: copy.description,
  alternates: englishPublicAlternates("/briefs"),
  openGraph: { title: copy.metadataTitle, description: copy.description, url: "/briefs" } };

export default function BriefsPage() {
  return <div className="min-h-screen bg-paper-2">
    <SiteHeader />
    <main className="mx-auto max-w-[1080px] px-4 py-12 sm:px-[30px]">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy.kicker}</p>
      <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{copy.title}</h1>
      <p className="mt-5 max-w-[76ch] font-serif text-lg leading-relaxed text-ink-2">{copy.introduction}</p>
      <p className="mt-3 max-w-[80ch] font-serif text-sm text-ink-3">{copy.scopeNotice}</p>
      <SpecialistBriefBuilder />
      <aside className="mt-10 border-t border-line pt-6">
        <h2 className="font-display text-2xl">{copy.pricingTitle}</h2>
        <p className="mt-3 max-w-[80ch] font-serif leading-relaxed text-ink-2">{copy.pricingBody}</p>
        <Link href="/pricing" className="mt-3 inline-flex min-h-11 items-center font-mono text-sm text-paid underline underline-offset-4">{copy.pricingAction}</Link>
      </aside>
    </main>
    <SiteFooter />
  </div>;
}
