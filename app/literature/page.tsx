import { createMessages } from "@/lib/i18n/messages";
import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { LiteratureWorkspace } from "@/components/keryx/literature-workspace";
import { SponsoredTrialNotice } from "@/components/keryx/sponsored-trial-notice";
import { evidenceDraftCopy as draftCopy } from "@/lib/research/evidence-draft-copy";
import { draftCheckCopy as checkCopy } from "@/lib/research/draft-check-copy";

const copy = createMessages("en");

export const metadata: Metadata = {
  title: copy("literaturePage.title"),
  description: copy("literaturePage.description"),
  alternates: englishPublicAlternates("/literature"),
};

export default function LiteraturePage() {
  return <div className="min-h-screen bg-paper-2">
    <SiteHeader />
    <main className="mx-auto max-w-[1040px] px-4 pb-20 pt-12 sm:px-[30px]">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">{copy("literaturePage.kicker")}</p>
      <h1 className="mt-3 font-display text-[clamp(30px,5vw,46px)] font-medium leading-tight text-ink">{copy("literaturePage.heading")}</h1>
      <p className="mt-4 max-w-[65ch] font-serif text-lg leading-relaxed text-ink-2">{copy("literaturePage.intro")}</p>
      <nav aria-label={copy("literaturePage.workflowLabel")} className="mt-5 flex flex-wrap gap-3">
        <Link prefetch={false} href="/sources?kind=paper#research-papers" className="inline-flex min-h-11 items-center border border-ink bg-seal px-4 py-2 font-mono text-xs text-paper">{copy("literaturePage.find")}</Link>
        <a href="#literature-project" className="inline-flex min-h-11 items-center px-2 py-2 font-mono text-xs text-seal underline">{copy("literaturePage.focus")}</a>
        <Link prefetch={false} href="/literature/drafts" className="inline-flex min-h-11 items-center px-2 py-2 font-mono text-xs text-seal underline">{draftCopy.page.navigation}</Link>
        <Link prefetch={false} href="/literature/check" className="inline-flex min-h-11 items-center px-2 py-2 font-mono text-xs text-seal underline">{checkCopy.page.navigation}</Link>
      </nav>
      <div className="mt-6"><SponsoredTrialNotice prepareQuestion /></div>
      <LiteratureWorkspace />
      <noscript><p className="mt-5 font-serif text-sm text-ink-2">{copy("literaturePage.noscript")}</p></noscript>
    </main>
    <SiteFooter />
  </div>;
}
