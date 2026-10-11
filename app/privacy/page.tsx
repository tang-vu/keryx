/**
 * /privacy — the privacy policy for keryx.cc and the Keryx browser extension.
 * A Chrome Web Store listing requires a live privacy-policy URL, and a payments
 * product owes its users a plain-language one regardless. Static page; every
 * claim in here mirrors what the code actually does — update it when behavior changes.
 */

import type { Metadata } from "next";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { currentArcLabel } from "@/lib/arc-network-display";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";

const message = createMessages("en");
const richMessage = createRichMessages("en");

const TITLE = message("legal.privacy.metadataTitle");
const DESCRIPTION =
  message("legal.privacy.metadataDescription");

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
};

const UPDATED = "October 11, 2026";

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

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">{message("legal.finePrint")}</div>
        <h1 className="font-display text-[clamp(30px,5vw,44px)] font-medium leading-[1.05] tracking-tight text-ink">{message("legal.privacy.title")}</h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">{message("legal.privacy.updated", { date: UPDATED })}</p>

        <Section title={message("legal.privacy.shortVersion.heading")}>
          <p>{richMessage("legal.privacy.shortVersion.summary", { network: currentArcLabel, publishedNotice: <strong className="text-ink">{message("legal.privacy.shortVersion.publicNotice")}</strong> })}</p>
        </Section>

        <Section title={message("legal.privacy.publicQuestions.heading")}>
          <p>{richMessage("legal.privacy.publicQuestions.processing", { dispatchPath: <span className="font-mono text-[13.5px]">/dispatch/…</span>, archiveLink: <Link href="/answers" className="text-seal underline underline-offset-2">{message("legal.privacy.archive")}</Link> })}</p>
          <p>{message("legal.privacy.publicQuestions.rateLimits")}</p>
        </Section>

        <Section title={message("legal.privacy.literatureWorkspace.heading")}>
          <p>{richMessage("legal.privacy.literatureWorkspace.localData", { literatureLink: <Link href="/literature" className="text-seal underline">{message("legal.privacy.literatureWorkspace.link")}</Link> })}</p>
          <p>{message("legal.privacy.literatureWorkspace.comparisonAndDeletion")}</p>
        </Section>

        <Section title={message("legal.privacy.privatePilot.heading")}>
          <p>{message("legal.privacy.privatePilot.processing")}</p>
          <p>{message("legal.privacy.privatePilot.localRecovery")}</p>
          <p>{richMessage("legal.privacy.privatePilot.localDeletion", { researchLink: <Link href="/research" className="text-seal underline underline-offset-2">{message("legal.privacy.privatePilot.researchLink")}</Link> })}</p>
        </Section>

        <Section title={message("legal.privacy.aggregateCounters.heading")}>
          <p>{message("legal.privacy.aggregateCounters.collection")}</p>
        </Section>

        <Section title={message("legal.privacy.walletAccounts.heading")}>
          <p>{message("legal.privacy.walletAccounts.accountData")}</p>
          {!browserPaymentProfile().testnet&&<p>{message("legal.privacy.walletAccounts.mainnetRecovery")}</p>}
        </Section>

        <Section title={message("legal.privacy.googleSignIn.heading")}>
          <p>{message("legal.privacy.googleSignIn.processing")}</p>
          <p>{message("legal.privacy.googleSignIn.credentials")}</p>
          <p>{message("legal.privacy.googleSignIn.recovery")}</p>
          <p>{richMessage("legal.privacy.googleSignIn.privacyPolicies", { googlePolicyLink: <a href="https://policies.google.com/privacy" className="text-seal underline underline-offset-2">{message("legal.privacy.googleSignIn.googlePolicy")}</a>, circlePolicyLink: <a href="https://www.circle.com/legal/privacy-policy" className="text-seal underline underline-offset-2">{message("legal.privacy.googleSignIn.circlePolicy")}</a> })}</p>
        </Section>

        <Section title={message("legal.privacy.sourceListings.heading")}>
          <p>{message("legal.privacy.sourceListings.publicAndPrivateFields")}</p>
        </Section>

        <Section title={message("legal.privacy.extension.heading")}>
          <p>{richMessage("legal.privacy.extension.destinations", { serviceOrigin: <span className="font-mono text-[13.5px]">https://keryx.cc</span> })}</p>
          <ul className="ml-5 flex list-disc flex-col gap-2">
            <li>{message("legal.privacy.extension.asking")}</li>
            <li>{richMessage("legal.privacy.extension.listPage", { listAction: <em>{message("legal.privacy.extension.listAction")}</em> })}</li>
            <li>{message("legal.privacy.extension.selection")}</li>
            <li>{richMessage("legal.privacy.extension.localStorage", { storageApi: <span className="font-mono text-[13.5px]">chrome.storage.local</span> })}</li>
          </ul>
        </Section>

        <Section title={message("legal.privacy.thirdParties.heading")}>
          <p>{richMessage("legal.privacy.thirdParties.reasoningAndPayments", { workersPolicyLink: <a href="https://developers.cloudflare.com/workers-ai/platform/data-usage/" className="text-seal underline underline-offset-2">{message("legal.privacy.thirdParties.workersPolicy")}</a> })}</p>
          <p>{richMessage("legal.privacy.thirdParties.webServices", { collectionLink: <a href="https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/" className="text-seal underline underline-offset-2">{message("legal.privacy.thirdParties.collectionLink")}</a> })}</p>
        </Section>

        <Section title={message("legal.privacy.retentionAndContact.heading")}>
          <p>{richMessage("legal.privacy.retentionAndContact.records", { contactAddress: <a href="mailto:vutang2212@gmail.com" className="text-seal underline underline-offset-2">
              vutang2212@gmail.com
            </a> })}</p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
