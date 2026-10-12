import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { EvidenceProcurementWalletWorkspace } from "@/components/keryx/evidence-procurement-wallet-workspace";

export const metadata: Metadata = {
  title: "Request missing evidence | Keryx",
  description: "Prepare a private evidence request, compare signed provider quotations, and review exact supplied excerpts under a bounded quote budget.",
  alternates: { canonical: "/operator/evidence" }, robots: { index: false, follow: false },
};

export default function EvidenceProcurementPage() {
  return <div className="min-h-screen bg-paper-2 text-ink"><SiteHeader />
    <main className="mx-auto max-w-[1040px] px-4 pb-20 pt-12 sm:px-[30px]">
      <Link prefetch={false} href="/operator" className="font-mono text-xs text-seal underline">Back to Operator</Link>
      <p className="mt-6 font-mono text-xs uppercase tracking-[0.15em] text-seal">Private evidence procurement · proposal workspace</p>
      <h1 className="mt-3 font-display text-[clamp(28px,5vw,42px)] leading-tight">When the evidence you need is missing</h1>
      <p className="mt-4 font-serif text-lg text-ink-2">Turn a gap in your research into a bounded request for new evidence.</p>
      <EvidenceProcurementWalletWorkspace />
      <noscript><p className="mt-5 font-serif text-sm">JavaScript is required for this tab-memory workspace. No request is submitted on this page.</p></noscript>
    </main><SiteFooter /></div>;
}
