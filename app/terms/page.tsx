import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { createMessages } from "@/lib/i18n/messages";

import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/public-support";
import { UiMessage, UiRichMessage } from "@/lib/i18n/ui-copy";



const message = createMessages("en");


export const metadata: Metadata = {
  title: message("legal.terms.metadataTitle"),
  description: message("legal.terms.metadataDescription"),
  alternates: englishPublicAlternates("/terms"),
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-[21px] font-medium tracking-tight text-ink">{title}</h2>
      <div className="mt-2.5 flex flex-col gap-3 font-serif text-[15.5px] leading-[1.6] text-ink-2">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal"><UiMessage messageKey={"legal.finePrint"} /></div>
        <h1 className="font-display text-[clamp(30px,5vw,44px)] font-medium leading-[1.05] tracking-tight text-ink"><UiMessage messageKey={"legal.terms.title"} /></h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3"><UiMessage messageKey={"legal.terms.effective"} /></p>

        <Section title={message("legal.terms.usingKeryx.heading")}>
          <p><UiMessage messageKey={"legal.terms.usingKeryx.scope"} /></p>
          <p><UiMessage messageKey={"legal.terms.usingKeryx.researchLimitations"} /></p>
        </Section>

        <Section title={message("legal.terms.accountsAndRecovery.heading")}>
          <p><UiMessage messageKey={"legal.terms.accountsAndRecovery.authorizations"} /></p>
          <p><UiMessage messageKey={"legal.terms.accountsAndRecovery.localRecovery"} /></p>
        </Section>

        <Section title={message("legal.terms.pricesAndDelivery.heading")}>
          <p><UiMessage messageKey={"legal.terms.pricesAndDelivery.charges"} /></p>
          <p><UiMessage messageKey={"legal.terms.pricesAndDelivery.uncertainPayments"} /></p>
          <p><UiMessage messageKey={"legal.terms.pricesAndDelivery.providerTerms"} /></p>
        </Section>

        <Section title={message("legal.terms.questionsAndContent.heading")}>
          <p><UiMessage messageKey={"legal.terms.questionsAndContent.publication"} /></p>
          <p><UiMessage messageKey={"legal.terms.questionsAndContent.rightsAndRewards"} /></p>
          <p><UiMessage messageKey={"legal.terms.questionsAndContent.prohibitedUse"} /></p>
        </Section>

        <Section title={message("legal.terms.privacyAndAvailability.heading")}>
          <p><UiRichMessage messageKey={"legal.terms.privacyAndAvailability.processing"} values={{ privacyLink: <Link href="/privacy" className="text-seal underline underline-offset-2"><UiMessage messageKey={"legal.terms.privacyAndAvailability.policyLink"} /></Link> }} /></p>
          <p><UiMessage messageKey={"legal.terms.privacyAndAvailability.changes"} /></p>
        </Section>

        <Section title={message("legal.terms.contact.heading")}>
          <p><UiRichMessage messageKey={"legal.terms.contact.support"} values={{ contactAddress: <a href={SUPPORT_MAILTO} className="text-seal underline underline-offset-2">{SUPPORT_EMAIL}</a> }} /></p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
