import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ResearchChat } from "@/components/keryx/research-chat";
import { ResearchRequest } from "@/components/keryx/research-request";
import { ResearchJob } from "@/components/keryx/research-job";
import { ResearchWorkspace } from "@/components/keryx/research-workspace";
import { ResearchSavedJobs } from "@/components/keryx/research-saved-jobs";
import { ResearchAccountJobs } from "@/components/keryx/research-account-jobs";
import { ResearchPrivateJobs } from "@/components/keryx/research-private-jobs";
import { ResearchPrivateCheckout } from "@/components/keryx/research-private-checkout";
import { ResearchEvidenceBrowser } from "@/components/keryx/research-evidence-browser";
import { privateMerchantPolicySchema } from "@/lib/buyer/private-merchant-policy";
import { config } from "@/lib/config";
import { quoteA2aResearch } from "@/lib/a2a/pricing";
import { parseBuyerBudget } from "@/lib/a2a/buyer-workspace";
import { monthlyAdmissionQuote } from "@/lib/monthly/readiness";
import { ResearchMonthly } from "@/components/keryx/research-monthly";
import { getDb } from "@/lib/db";
import { assertMainnetHostedResearchReady } from "@/lib/payments/mainnet-hosted-gateway";

const copy = createMessages("en");
const richCopy = createRichMessages("en");

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: copy("paidResearch.pageTitle"),
  description: copy("paidResearch.pageDescription"),
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
  const available = await (async () => { try {
    if (!config.sellerAddress || process.env.KERYX_FORCE_OFFLINE === "1") return false;
    if (config.profile.testnet) return !!config.funderKey;
    if (!quote) return false;
    await assertMainnetHostedResearchReady(await getDb(), String(Math.round(quote.creatorBudgetUsdc * 1e6)));
    return true;
  } catch { return false; } })();
  const privatePolicy = privateMerchantPolicySchema.safeParse({ privatePayee: process.env.KERYX_PRIVATE_RESEARCH_PAYEE, publicResearchPayee: config.sellerAddress });
  const monthlyQuote = await (async () => { try {
    return await monthlyAdmissionQuote(await getDb());
  } catch { return null; } })();
  return (
    <div className="min-h-screen bg-paper-2 text-ink">
      <SiteHeader />
      <main>
      <ResearchChat paidHref="#paid-research" />
      <div className="mx-auto max-w-[1080px] space-y-10 px-4 py-12 sm:px-[30px]">
        <header id="paid-research" className="scroll-mt-24 border-b border-line pb-8">
          <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy("paidResearch.kicker", { network: config.profile.label })}</p>
          <h2 className="mt-3 font-display text-4xl">{copy("paidResearch.title")}</h2>
          <p className="mt-5 max-w-2xl font-serif text-lg text-ink-2">{copy("paidResearch.introduction")}</p>
          <p className="mt-3 font-serif text-sm text-ink-3">{copy("paidResearch.recoveryNotice")}</p>
        </header>
        <ResearchEvidenceBrowser />
        <ResearchWorkspace>
        <section aria-labelledby="package-heading" className="border border-line bg-paper p-6">
          <h2 id="package-heading" className="font-display text-3xl">{copy("paidResearch.priceTitle")}</h2>
          <form action="/research#paid-research" className="mt-5 flex flex-wrap items-end gap-4">
            <label className="grid gap-2 font-mono text-xs">{copy("paidResearch.package")}
              <select name="mode" defaultValue={mode} className="border border-line bg-paper-2 p-3 text-sm">
                <option value="quick">{copy("paidResearch.quick")}</option><option value="deep">{copy("paidResearch.deep")}</option>
              </select>
            </label>
            <label className="grid gap-2 font-mono text-xs">{copy("paidResearch.cap")}
              <input name="budget" defaultValue={rawBudget} type="number" min="0.000001" max={config.a2aMaxBudget} step="0.000001" required className="w-44 border border-line bg-paper-2 p-3 text-sm" />
            </label>
            <button className="bg-ink px-5 py-3 font-mono text-sm text-paper">{copy("paidResearch.updatePrice")}</button>
          </form>
          {!quote && <p role="alert" className="mt-4 text-seal">{copy("paidResearch.invalidPrice", { maximum: config.a2aMaxBudget })}</p>}
          {quote?.researchPackage && <>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[[copy("paidResearch.serviceFee"), quote.serviceFeeUsdc], [copy("paidResearch.creatorCap"), quote.creatorBudgetUsdc], [copy("paidResearch.totalPrice"), quote.totalPriceUsdc]].map(([label, value]) => (
                <div key={label} className="border border-line p-4"><p className="font-mono text-xs text-ink-3">{label}</p><p className="mt-2 font-display text-3xl">{value} <span className="text-sm">USDC</span></p></div>
              ))}
            </div>
            <p className="mt-4 font-serif text-ink-2">{[copy(quote.researchPackage.execution.attentionLimit === 1 ? "paidResearch.sources.one" : "paidResearch.sources.other", { count: quote.researchPackage.execution.attentionLimit }), copy(quote.researchPackage.execution.reevaluateRounds === 1 ? "paidResearch.rounds.one" : "paidResearch.rounds.other", { count: quote.researchPackage.execution.reevaluateRounds }), copy("paidResearch.target", { seconds: quote.researchPackage.serviceLevel.targetCompletionMs / 1000 })].join(" · ")}</p>
            <p className="mt-2 font-serif text-sm text-ink-3">{copy("paidResearch.terms")}</p>
            {available ? <>
              <p className="mt-4 break-all font-mono text-xs">{richCopy("paidResearch.paymentIdentity", { network: config.networkId, payee: config.sellerAddress, lineBreak: <br /> })}</p>
              <ResearchRequest key={`${mode}:${quote.creatorBudgetUsdc}`} mode={mode} budget={quote.creatorBudgetUsdc} version={quote.researchPackage.version} total={quote.totalPriceUsdc} payee={config.sellerAddress} />
            </> : <p role="status" className="mt-4 text-seal">{copy("paidResearch.unavailable", { network: config.profile.label })}</p>}
          </>}
        </section>
        <ResearchSavedJobs />
        </ResearchWorkspace>
        <ResearchAccountJobs />
        {monthlyQuote && <ResearchMonthly quote={monthlyQuote} />}
        {process.env.KERYX_PRIVATE_RESEARCH_ENABLED === "1" && privatePolicy.success
          && <ResearchPrivateCheckout merchants={privatePolicy.data} />}
        <ResearchPrivateJobs />
        <ResearchJob />
        <p className="font-serif text-ink-3">{richCopy("paidResearch.apiHelp", { referenceLink: <Link href="/api/docs" className="underline">{copy("paidResearch.apiReference")}</Link>, playgroundLink: <Link href="/playground" className="underline">{copy("paidResearch.playground")}</Link> })}</p>
      </div>
      </main>
      <SiteFooter />
    </div>
  );
}
