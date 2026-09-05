import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ResearchRequest } from "@/components/keryx/research-request";
import { ResearchJob } from "@/components/keryx/research-job";
import { config } from "@/lib/config";
import { quoteA2aResearch } from "@/lib/a2a/pricing";
import { parseBuyerBudget } from "@/lib/a2a/buyer-workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Paid research — Keryx",
  description: "Price a research package, prepare your agent's request, and inspect its evidence and creator settlement.",
  robots: { index: false, follow: true },
};

export default async function ResearchPage({ searchParams }: {
  searchParams: Promise<{ budget?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const rawBudget = typeof params.budget === "string" ? params.budget : String(Math.min(config.defaultBudget, config.a2aMaxBudget));
  const budget = parseBuyerBudget(rawBudget, config.a2aMaxBudget);
  const mode = params.mode === "quick" ? "quick" : "deep";
  const validMode = params.mode === undefined || params.mode === "quick" || params.mode === "deep";
  const quote = budget !== null && validMode ? quoteA2aResearch(budget, mode) : null;
  const available = config.networkId === "eip155:5042002" && !!config.sellerAddress && !!config.funderKey && process.env.KERYX_FORCE_OFFLINE !== "1";
  return (
    <div className="min-h-screen bg-paper-2 text-ink">
      <SiteHeader />
      <main className="mx-auto max-w-[1080px] space-y-10 px-4 py-12 sm:px-[30px]">
        <header className="border-b border-line pb-8">
          <p className="font-mono text-xs uppercase tracking-widest text-seal">Paid research · Arc testnet</p>
          <h1 className="mt-3 font-display text-5xl">Give your agent a research budget.</h1>
          <p className="mt-5 max-w-2xl font-serif text-lg text-ink-2">Know the price before your agent pays. Follow the job, read its evidence, and see what reached creators.</p>
          <p className="mt-3 font-serif text-sm text-ink-3">Use a funded x402 client to purchase. This workspace prepares requests and follows existing jobs.</p>
        </header>
        <section aria-labelledby="package-heading" className="border border-line bg-paper p-6">
          <h2 id="package-heading" className="font-display text-3xl">1. Price your research</h2>
          <form action="/research" className="mt-5 flex flex-wrap items-end gap-4">
            <label className="grid gap-2 font-mono text-xs">Package
              <select name="mode" defaultValue={mode} className="border border-line bg-paper-2 p-3 text-sm">
                <option value="quick">Quick</option><option value="deep">Deep</option>
              </select>
            </label>
            <label className="grid gap-2 font-mono text-xs">Creator cap (USDC)
              <input name="budget" defaultValue={rawBudget} type="number" min="0.000001" max={config.a2aMaxBudget} step="0.000001" required className="w-44 border border-line bg-paper-2 p-3 text-sm" />
            </label>
            <button className="bg-ink px-5 py-3 font-mono text-sm text-paper">Update price</button>
          </form>
          {!quote && <p role="alert" className="mt-4 text-seal">Choose Quick or Deep and a cap between 0.000001 and {config.a2aMaxBudget} USDC, with at most six decimal places.</p>}
          {quote?.researchPackage && <>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[['Service fee', quote.serviceFeeUsdc], ['Creator cap', quote.creatorBudgetUsdc], ['Total package price', quote.totalPriceUsdc]].map(([label, value]) => (
                <div key={label} className="border border-line p-4"><p className="font-mono text-xs text-ink-3">{label}</p><p className="mt-2 font-display text-3xl">{value} <span className="text-sm">USDC</span></p></div>
              ))}
            </div>
            <p className="mt-4 font-serif text-ink-2">Up to {quote.researchPackage.execution.attentionLimit} sources considered for synthesis · {quote.researchPackage.execution.reevaluateRounds} re-evaluation rounds · {quote.researchPackage.serviceLevel.targetCompletionMs / 1000}s provisional completion target.</p>
            <p className="mt-2 font-serif text-sm text-ink-3">Fixed-price and non-refundable. Unused creator reserve stays in the package. Quality is best effort; the provisional target has no refund or service-credit remedy. The payment challenge at purchase is authoritative.</p>
            {available ? <>
              <p className="mt-4 break-all font-mono text-xs">Payment network: {config.networkId}<br />Keryx payee: {config.sellerAddress}</p>
              <ResearchRequest key={`${mode}:${quote.creatorBudgetUsdc}`} mode={mode} budget={quote.creatorBudgetUsdc} version={quote.researchPackage.version} total={quote.totalPriceUsdc} />
            </> : <p role="status" className="mt-4 text-seal">Paid testnet research is currently unavailable. Job lookup remains available below.</p>}
          </>}
        </section>
        <ResearchJob />
        <p className="font-serif text-ink-3">New to the API? <Link href="/api/docs" className="underline">Read the API reference</Link>. To try a sponsored question, <Link href="/playground" className="underline">open the playground</Link>.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
