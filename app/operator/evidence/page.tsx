import type { Metadata } from "next";
import { evidenceProcurementCopy as copy } from "@/lib/evidence-procurement/copy";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { EvidenceProcurementWalletWorkspace } from "@/components/keryx/evidence-procurement-wallet-workspace";

export const metadata: Metadata = {
  title: copy.page.metadataTitle,
  description: copy.page.metadataDescription,
  alternates: { canonical: "/operator/evidence" }, robots: { index: false, follow: false },
};

export default function EvidenceProcurementPage() {
  return <div className="min-h-screen bg-paper-2 text-ink"><SiteHeader />
    <main className="mx-auto max-w-[1040px] px-4 pb-20 pt-12 sm:px-[30px]">
      <Link prefetch={false} href="/operator" className="font-mono text-xs text-seal underline">{copy.page.back}</Link>
      <p className="mt-6 font-mono text-xs uppercase tracking-[0.15em] text-seal">{copy.page.kicker}</p>
      <h1 className="mt-3 font-display text-[clamp(28px,5vw,42px)] leading-tight">{copy.page.heading}</h1>
      <p className="mt-4 font-serif text-lg text-ink-2">{copy.page.introduction}</p>
      <EvidenceProcurementWalletWorkspace />
      <noscript><p className="mt-5 font-serif text-sm">{copy.page.noScript}</p></noscript>
    </main><SiteFooter /></div>;
}
