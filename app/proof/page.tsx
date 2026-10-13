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
import { createRichMessages } from "@/lib/i18n/rich-messages";

const message = createMessages("en");
const richMessage = createRichMessages("en");

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
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal">{message("proofPage.publicProof")}</div>
        <h1 className="mt-2 max-w-[16ch] font-display text-[clamp(34px,6vw,58px)] font-medium leading-[0.98] tracking-tight text-ink">{richMessage("proofPage.title", { emphasis: <em className="italic text-paid">{message("proofPage.limitsAttached")}</em> })}</h1>
        <p className="mt-5 max-w-[68ch] font-serif text-[17px] leading-[1.6] text-ink-2">{message("proofPage.verifyTheDeployedCodeSourceAuthoritySettledPayments")}</p>
        <p className="mt-3 max-w-[68ch] font-serif text-[15px] leading-relaxed text-ink-2">{richMessage("proofPage.integrationLedgerInstruction", { beforeLink: " ", link: <a
            href="https://github.com/tang-vu/keryx/blob/main/docs/engineering/circle-arc-integration-ledger.md"
            className="text-paid underline underline-offset-4"
          >{message("proofPage.circleAndArcIntegrationLedger")}</a>, afterLink: " " })}</p>

        <section className="mt-9 grid gap-3 sm:grid-cols-3">
          {LAYERS.map((layer, index) => (
            <article key={layer.source} className="border border-line bg-paper p-5">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-seal">
                0{index + 1} · {layer.source}
              </div>
              <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink">{layer.proves}</p>
              <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-faint">{richMessage("proofPage.limit", { limit: layer.limit })}</p>
            </article>
          ))}
        </section>

        <section className="mt-9 border border-line bg-paper p-5">
          <h2 className="font-display text-[24px] text-ink">{proofMessages.studyTitle}</h2>
          <p className="mt-3 max-w-[74ch] font-serif text-[15px] leading-relaxed text-ink-2">
            {proofMessages.studyDescription}
          </p>
          <p className="mt-3 max-w-[74ch] font-mono text-[11px] leading-relaxed text-faint">
            {proofMessages.studyLimit}
          </p>
          <a
            href="https://github.com/tang-vu/keryx/blob/main/docs/studies/paying-for-sources-2026-10-09.md"
            className="mt-4 inline-block text-paid underline underline-offset-4"
          >
            {proofMessages.studyLink}
          </a>
        </section>

        <ProofDashboard />
        <p className="mt-6 font-serif text-ink-2"><Link href="/usage" className="text-paid underline underline-offset-4">{usageMessages.proofLink}</Link> {usageMessages.proofLimit}</p>
        <HistoricalHistorySection />
      </main>
      <SiteFooter />
    </div>
  );
}
