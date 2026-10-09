import type { Metadata } from "next";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SiteHeader } from "@/components/keryx/site-header";
import { ProofDashboard } from "@/components/keryx/proof-dashboard";
import { HistoricalHistorySection } from "@/components/keryx/testnet-history-summary";
import { proofMessages } from "@/locales/en/proof";

export const dynamic = "force-dynamic";

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = "Public proof — Keryx";
const DESCRIPTION =
  "Live evidence for Keryx's open-source build, Arc registry authority, Circle settlement, and creator cash-outs.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/proof" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${BASE}/proof`, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const LAYERS = [
  {
    source: "GitHub + runtime commit",
    proves: "The reviewed source is the build currently serving traffic.",
    limit: "It does not prove that a payment settled.",
  },
  {
    source: "Arc RPC + SourceRegistry",
    proves: "Who controls a source, its price ceiling, payout wallet, and author splits.",
    limit: "It does not turn a database row into payout authority.",
  },
  {
    source: "Circle Gateway API",
    proves: "Payee balances back the settled ledger, wallet by wallet.",
    limit: "Batched transfers have Circle IDs, not one ArcScan tx per citation.",
  },
] as const;

export default function ProofPage() {
  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[980px] px-4 pb-20 pt-12 sm:px-[30px]">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          Public proof
        </div>
        <h1 className="mt-2 max-w-[16ch] font-display text-[clamp(34px,6vw,58px)] font-medium leading-[0.98] tracking-tight text-ink">
          Evidence, with its <em className="italic text-paid">limits attached.</em>
        </h1>
        <p className="mt-5 max-w-[68ch] font-serif text-[17px] leading-[1.6] text-ink-2">
          Verify the deployed code, source authority, settled payments, and creator cash-outs
          through the records behind each claim.
        </p>
        <p className="mt-3 max-w-[68ch] font-serif text-[15px] leading-relaxed text-ink-2">
          The{" "}
          <a
            href="https://github.com/tang-vu/keryx/blob/main/docs/engineering/circle-arc-integration-ledger.md"
            className="text-paid underline underline-offset-4"
          >
            Circle and Arc integration ledger
          </a>{" "}
          links each tool to its code and evidence, including the remaining sponsored
          testnet proof for gasless user actions.
        </p>

        <section className="mt-9 grid gap-3 sm:grid-cols-3">
          {LAYERS.map((layer, index) => (
            <article key={layer.source} className="border border-line bg-paper p-5">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-seal">
                0{index + 1} · {layer.source}
              </div>
              <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink">{layer.proves}</p>
              <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-faint">
                Limit: {layer.limit}
              </p>
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
        <HistoricalHistorySection />
      </main>
      <SiteFooter />
    </div>
  );
}
