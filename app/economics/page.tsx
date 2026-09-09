import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { BusinessCalculator } from "@/components/keryx/business-calculator";

export const metadata: Metadata = { title: "Business calculator — Keryx", description: "Model research-package costs, contribution and break-even with explicit assumptions." };

export default function EconomicsPage() {
  return <div className="min-h-screen bg-paper-2 text-ink"><SiteHeader />
    <main className="mx-auto max-w-[1080px] space-y-8 px-4 py-12 sm:px-[30px]">
      <header className="border-b border-line pb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-seal">Business planning</p>
        <h1 className="mt-3 font-display text-5xl">What does a research job earn?</h1>
        <p className="mt-5 max-w-3xl font-serif text-lg text-ink-2">Compare service-fee contribution and fixed-package reserve retention. Test your costs and demand to understand monthly operating results and the volume needed to break even.</p>
        <p className="mt-3 font-serif text-sm text-ink-3">This calculator uses assumptions, not realized revenue. It does not import testnet activity, change package prices or make payments. The illustrative fees are editable examples.</p>
      </header>
      <BusinessCalculator />
      <p className="font-serif text-ink-3">Package receipts are not automatically recognized revenue or profit. Useful research and creator obligations remain part of the service. <Link href="/research" className="underline">View current research offers</Link>.</p>
    </main><SiteFooter /></div>;
}
