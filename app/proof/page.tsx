import type { Metadata } from "next";
import { SiteFooter } from "@/components/keryx/site-footer";
import { SiteHeader } from "@/components/keryx/site-header";
import { ProofDashboard } from "@/components/keryx/proof-dashboard";

const BASE = process.env.BASE_URL || "https://keryx.cc";
const TITLE = "Public proof — Keryx";
const DESCRIPTION =
  "Live, source-linked evidence for Keryx's open-source build, Arc registry authority, Circle settlement, creator cash-outs, and independently initiated usage.";

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
    proves: "Creator balances back the settled ledger, wallet by wallet.",
    limit: "Batched transfers have Circle IDs, not one ArcScan tx per citation.",
  },
  {
    source: "Settled-only provenance ledger",
    proves: "Which demand came from outside users and which came from Keryx's own agents.",
    limit: "Anonymous queries are never inflated into unique-user claims.",
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
          No single counter proves Keryx works. Code, authority, settlement and adoption each have a
          different source of truth. This page composes those sources without treating autonomous
          first-party volume as outside demand—or a database receipt as on-chain fact.
        </p>

        <section className="mt-9 grid gap-3 sm:grid-cols-2">
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

        <ProofDashboard />
      </main>
      <SiteFooter />
    </div>
  );
}
