import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { BusinessCalculator } from "@/components/keryx/business-calculator";
import { createMessages } from "@/lib/i18n/messages";

import { UiMessage, UiRichMessage } from "@/lib/i18n/ui-copy";



const message = createMessages("en");


export const metadata: Metadata = { title: message("economicsPage.metadataTitle"), description: message("economicsPage.metadataDescription"), alternates: englishPublicAlternates("/economics") };

export default function EconomicsPage() {
  return <div className="min-h-screen bg-paper-2 text-ink"><SiteHeader />
    <main className="mx-auto max-w-[1080px] space-y-8 px-4 py-12 sm:px-[30px]">
      <header className="border-b border-line pb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-seal"><UiMessage messageKey={"economicsPage.businessPlanning"} /></p>
        <h1 className="mt-3 font-display text-5xl"><UiMessage messageKey={"economicsPage.whatDoesAResearchJobEarn"} /></h1>
        <p className="mt-5 max-w-3xl font-serif text-lg text-ink-2"><UiMessage messageKey={"economicsPage.compareServiceFeeContributionAndFixedPackageReserve"} /></p>
        <p className="mt-3 font-serif text-sm text-ink-3"><UiMessage messageKey={"economicsPage.thisCalculatorUsesAssumptionsNotRealizedRevenueIt"} /></p>
      </header>
      <BusinessCalculator />
      <p className="font-serif text-ink-3"><UiRichMessage messageKey={"economicsPage.packageReceiptsAreNotAutomaticallyRecognizedRevenueOr"} values={{ link: <Link href="/research" className="underline"><UiMessage messageKey={"economicsPage.viewCurrentResearchOffers"} /></Link> }} /></p>
    </main><SiteFooter /></div>;
}
