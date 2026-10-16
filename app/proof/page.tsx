import type { Metadata } from "next";
import Link from "next/link";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SiteHeader } from "@/components/keryx/site-header";
import { ProofDashboard } from "@/components/keryx/proof-dashboard";
import { HistoricalHistorySection } from "@/components/keryx/testnet-history-summary";
import { usageMessages } from "@/locales/en/usage";
import { proofMessages } from "@/locales/en/proof";
import { createMessages } from "@/lib/i18n/messages";

import { UiMessage, UiRichMessage, UiText } from "@/lib/i18n/ui-copy";



const message = createMessages("en");


export const dynamic = "force-dynamic";

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = message("proofPage.metadataTitle");
const DESCRIPTION =
  message("proofPage.metadataDescription");

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: englishPublicAlternates("/proof"),
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${BASE}/proof`, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const LAYERS = [
  {
    source: message("proofPage.gitHubRuntimeCommit"),
    proves: message("proofPage.theReviewedSourceIsTheBuildCurrentlyServing"),
    limit: message("proofPage.itDoesNotProveThatAPaymentSettled"),
  },
  {
    source: message("proofPage.arcRPCSourceRegistry"),
    proves: message("proofPage.whoControlsASourceItsPriceCeilingPayout"),
    limit: message("proofPage.itDoesNotTurnADatabaseRowInto"),
  },
  {
    source: message("proofPage.circleGatewayAPI"),
    proves: message("proofPage.payeeBalancesBackTheSettledLedgerWalletBy"),
    limit: message("proofPage.batchedTransfersHaveCircleIDsNotOneArcScan"),
  },
] as const;

export default function ProofPage() {
  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[980px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal"><UiMessage messageKey={"proofPage.publicProof"} /></div>
        <h1 className="mt-2 max-w-[16ch] font-display text-[clamp(34px,6vw,58px)] font-medium leading-[0.98] tracking-tight text-ink"><UiRichMessage messageKey={"proofPage.title"} values={{ emphasis: <em className="italic text-paid"><UiMessage messageKey={"proofPage.limitsAttached"} /></em> }} /></h1>
        <p className="mt-5 max-w-[68ch] font-serif text-[17px] leading-[1.6] text-ink-2"><UiMessage messageKey={"proofPage.verifyTheDeployedCodeSourceAuthoritySettledPayments"} /></p>
        <p className="mt-3 max-w-[68ch] font-serif text-[15px] leading-relaxed text-ink-2"><UiRichMessage messageKey={"proofPage.integrationLedgerInstruction"} values={{ beforeLink: " ", link: <a
            href="https://github.com/tang-vu/keryx/blob/main/docs/engineering/circle-arc-integration-ledger.md"
            className="text-paid underline underline-offset-4"
          ><UiMessage messageKey={"proofPage.circleAndArcIntegrationLedger"} /></a>, afterLink: " " }} /></p>

        <section className="mt-9 grid gap-3 sm:grid-cols-3">
          {LAYERS.map((layer, index) => (
            <article key={layer.source} className="border border-line bg-paper p-5">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-seal">
                0{index + 1} · {layer.source}
              </div>
              <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink">{layer.proves}</p>
              <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-faint"><UiRichMessage messageKey={"proofPage.limit"} values={{ limit: layer.limit }} /></p>
            </article>
          ))}
        </section>

        <section className="mt-9 border border-line bg-paper p-5">
          <h2 className="font-display text-[24px] text-ink"><UiText source={proofMessages.studyTitle} namespaces={["usage","proof"]} /></h2>
          <p className="mt-3 max-w-[74ch] font-serif text-[15px] leading-relaxed text-ink-2">
            <UiText source={proofMessages.studyDescription} namespaces={["usage","proof"]} />
          </p>
          <p className="mt-3 max-w-[74ch] font-mono text-[11px] leading-relaxed text-faint">
            <UiText source={proofMessages.studyLimit} namespaces={["usage","proof"]} />
          </p>
          <a
            href="https://github.com/tang-vu/keryx/blob/main/docs/studies/paying-for-sources-2026-10-09.md"
            className="mt-4 inline-block text-paid underline underline-offset-4"
          >
            <UiText source={proofMessages.studyLink} namespaces={["usage","proof"]} />
          </a>
        </section>

        <ProofDashboard />
        <p className="mt-6 font-serif text-ink-2"><Link href="/usage" className="text-paid underline underline-offset-4"><UiText source={usageMessages.proofLink} namespaces={["usage","proof"]} /></Link> <UiText source={usageMessages.proofLimit} namespaces={["usage","proof"]} /></p>
        <HistoricalHistorySection />
      </main>
      <SiteFooter />
    </div>
  );
}
