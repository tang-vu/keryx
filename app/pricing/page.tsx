import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { config } from "@/lib/config";
import { quoteA2aResearch } from "@/lib/a2a/pricing";
import { formatRecordedAmount } from "@/lib/i18n/format";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { productGuideCopy as copy } from "@/locales/en/product-guide";
import { UiAttributes, UiText } from "@/lib/i18n/ui-copy";



export const metadata: Metadata = {
  title: copy("pricing.metadataTitle"),
  description: copy("pricing.description"),
  alternates: englishPublicAlternates("/pricing"),
  openGraph: { title: copy("pricing.metadataTitle"), description: copy("pricing.description"), url: "/pricing" },
  twitter: { title: copy("pricing.metadataTitle"), description: copy("pricing.description") },
};

const actionClass = "mt-5 inline-flex min-h-11 items-center font-mono text-sm text-paid underline underline-offset-4";
const amount = (value: number) => formatRecordedAmount(value, { minimumFractionDigits: 6 });

export default function PricingPage() {
  // Informational examples share checkout's configuration and integer pricing.
  // No readiness/database read, purchase, reservation or signature happens here.
  const packages = ["quick", "deep"].map(mode => ({
    label: copy(mode === "quick" ? "pricing.quick" : "pricing.deep"),
    quote: quoteA2aResearch(config.defaultBudget, mode as "quick" | "deep"),
  }));
  return <div className="min-h-screen bg-paper-2">
    <SiteHeader />
    <main className="mx-auto max-w-[1080px] px-4 py-12 sm:px-[30px]">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-seal"><UiText source={copy("product.pricing")} namespaces={["product-guide"]} /> · {config.profile.label} <UiText source={copy("pricing.currencySuffix")} namespaces={["product-guide"]} /></p>
        <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl"><UiText source={copy("pricing.title")} namespaces={["product-guide"]} /></h1>
        <p className="mt-5 max-w-[76ch] font-serif text-lg leading-relaxed text-ink-2"><UiText source={copy("pricing.introduction")} namespaces={["product-guide"]} /></p>
      </header>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section className="border border-paid bg-paper p-6">
          <h2 className="font-display text-2xl"><UiText source={copy("pricing.trialTitle")} namespaces={["product-guide"]} /></h2>
          <p className="mt-3 font-mono text-sm text-paid"><UiText source={copy("pricing.trialPrice")} namespaces={["product-guide"]} /></p>
          <p className="mt-4 font-serif leading-relaxed text-ink-2"><UiText source={copy("pricing.trialBody")} namespaces={["product-guide"]} /></p>
          <p className="mt-3 font-serif text-sm text-seal"><UiText source={copy("pricing.trialPrivacy")} namespaces={["product-guide"]} /></p>
          <Link href="/#dispatch" className={actionClass}><UiText source={copy("product.try")} namespaces={["product-guide"]} /></Link>
        </section>
        <section className="border border-line bg-paper p-6">
          <h2 className="font-display text-2xl"><UiText source={copy("pricing.browserTitle")} namespaces={["product-guide"]} /></h2>
          <p className="mt-3 font-mono text-sm text-paid"><UiText source={copy("pricing.browserPrice")} namespaces={["product-guide"]} /></p>
          <p className="mt-4 font-serif leading-relaxed text-ink-2"><UiText source={copy("pricing.browserBody")} namespaces={["product-guide"]} /></p>
          <p className="mt-3 font-serif text-sm text-ink-2"><UiText source={copy("pricing.browserFee")} namespaces={["product-guide"]} /></p>
          <Link href="/#dispatch" className={actionClass}><UiText source={copy("pricing.browserAction")} namespaces={["product-guide"]} /></Link>
        </section>
      </div>
      <section className="mt-8 border border-line bg-paper p-6 sm:p-8" aria-labelledby="prepaid-pricing">
        <h2 id="prepaid-pricing" className="font-display text-3xl"><UiText source={copy("pricing.prepaidTitle")} namespaces={["product-guide"]} /></h2>
        <p className="mt-4 max-w-[76ch] font-serif leading-relaxed text-ink-2"><UiText source={copy("pricing.prepaidBody")} namespaces={["product-guide"]} /></p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-xs sm:text-sm">
            <caption className="mb-3 text-left font-serif text-sm leading-relaxed text-ink-3"><UiText source={copy("pricing.quoteNotice")} namespaces={["product-guide"]} /></caption>
            <thead><tr className="border-b border-ink">
              {[copy("pricing.package"), copy("pricing.service"), copy("pricing.reserve"), copy("pricing.total")].map(label => <th key={label} className="px-2 py-3 font-medium"><UiText source={label} namespaces={["product-guide"]} /></th>)}
            </tr></thead>
            <tbody>{packages.map(({ label, quote }) => <tr key={label} className="border-b border-line">
              <th scope="row" className="px-2 py-4 font-medium"><UiText source={label} namespaces={["product-guide"]} /></th>
              {[quote.serviceFeeUsdc, quote.creatorBudgetUsdc, quote.totalPriceUsdc].map((value, index) => <td key={index} className="px-2 py-4 tabular-nums">{amount(value)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-4 max-w-[76ch] font-serif text-sm leading-relaxed text-ink-3"><UiText source={copy("pricing.prepaidTerms")} namespaces={["product-guide"]} /></p>
        <Link href="/research#paid-research" prefetch={false} className={actionClass}><UiText source={copy("pricing.checkout")} namespaces={["product-guide"]} /></Link>
      </section>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section className="border border-line p-6">
          <h2 className="font-display text-2xl"><UiText source={copy("pricing.monthlyTitle")} namespaces={["product-guide"]} /></h2>
          <p className="mt-4 font-serif leading-relaxed text-ink-2"><UiText source={copy("pricing.monthlyBody")} namespaces={["product-guide"]} /></p>
          <Link href="/research#paid-research" prefetch={false} className={actionClass}><UiText source={copy("pricing.checkout")} namespaces={["product-guide"]} /></Link>
        </section>
        <section className="border border-line p-6">
          <h2 className="font-display text-2xl"><UiText source={copy("pricing.creatorTitle")} namespaces={["product-guide"]} /></h2>
          <p className="mt-4 font-serif leading-relaxed text-ink-2"><UiText source={copy("pricing.creatorBody")} namespaces={["product-guide"]} /></p>
          <Link href="/register" className={actionClass}><UiText source={copy("pricing.creatorTitle")} namespaces={["product-guide"]} /></Link>
        </section>
      </div>
      <UiAttributes names={["aria-label"]} namespaces={["product-guide"]}><nav className="mt-6 flex flex-wrap gap-x-6" aria-label={copy("product.about")}>
        <Link href="/briefs" className={actionClass}><UiText source={copy("product.briefsAction")} namespaces={["product-guide"]} /></Link>
        <Link href="/about" className={actionClass}><UiText source={copy("product.about")} namespaces={["product-guide"]} /></Link>
        <Link href="/terms" className={actionClass}><UiText source={copy("product.terms")} namespaces={["product-guide"]} /></Link>
        <Link href="/privacy" className={actionClass}><UiText source={copy("product.privacy")} namespaces={["product-guide"]} /></Link>
      </nav></UiAttributes>
    </main>
    <SiteFooter />
  </div>;
}
