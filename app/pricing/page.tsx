import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { config } from "@/lib/config";
import { quoteA2aResearch } from "@/lib/a2a/pricing";
import { formatRecordedAmount } from "@/lib/i18n/format";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { productGuideCopy as copy } from "@/locales/en/product-guide";

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
        <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy("product.pricing")} · {config.profile.label} {copy("pricing.currencySuffix")}</p>
        <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{copy("pricing.title")}</h1>
        <p className="mt-5 max-w-[76ch] font-serif text-lg leading-relaxed text-ink-2">{copy("pricing.introduction")}</p>
      </header>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section className="border border-paid bg-paper p-6">
          <h2 className="font-display text-2xl">{copy("pricing.trialTitle")}</h2>
          <p className="mt-3 font-mono text-sm text-paid">{copy("pricing.trialPrice")}</p>
          <p className="mt-4 font-serif leading-relaxed text-ink-2">{copy("pricing.trialBody")}</p>
          <p className="mt-3 font-serif text-sm text-seal">{copy("pricing.trialPrivacy")}</p>
          <Link href="/#dispatch" className={actionClass}>{copy("product.try")}</Link>
        </section>
        <section className="border border-line bg-paper p-6">
          <h2 className="font-display text-2xl">{copy("pricing.browserTitle")}</h2>
          <p className="mt-3 font-mono text-sm text-paid">{copy("pricing.browserPrice")}</p>
          <p className="mt-4 font-serif leading-relaxed text-ink-2">{copy("pricing.browserBody")}</p>
          <p className="mt-3 font-serif text-sm text-ink-2">{copy("pricing.browserFee")}</p>
          <Link href="/#dispatch" className={actionClass}>{copy("pricing.browserAction")}</Link>
        </section>
      </div>
      <section className="mt-8 border border-line bg-paper p-6 sm:p-8" aria-labelledby="prepaid-pricing">
        <h2 id="prepaid-pricing" className="font-display text-3xl">{copy("pricing.prepaidTitle")}</h2>
        <p className="mt-4 max-w-[76ch] font-serif leading-relaxed text-ink-2">{copy("pricing.prepaidBody")}</p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-xs sm:text-sm">
            <caption className="mb-3 text-left font-serif text-sm leading-relaxed text-ink-3">{copy("pricing.quoteNotice")}</caption>
            <thead><tr className="border-b border-ink">
              {[copy("pricing.package"), copy("pricing.service"), copy("pricing.reserve"), copy("pricing.total")].map(label => <th key={label} className="px-2 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>{packages.map(({ label, quote }) => <tr key={label} className="border-b border-line">
              <th scope="row" className="px-2 py-4 font-medium">{label}</th>
              {[quote.serviceFeeUsdc, quote.creatorBudgetUsdc, quote.totalPriceUsdc].map((value, index) => <td key={index} className="px-2 py-4 tabular-nums">{amount(value)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-4 max-w-[76ch] font-serif text-sm leading-relaxed text-ink-3">{copy("pricing.prepaidTerms")}</p>
        <Link href="/research#paid-research" prefetch={false} className={actionClass}>{copy("pricing.checkout")}</Link>
      </section>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <section className="border border-line p-6">
          <h2 className="font-display text-2xl">{copy("pricing.monthlyTitle")}</h2>
          <p className="mt-4 font-serif leading-relaxed text-ink-2">{copy("pricing.monthlyBody")}</p>
          <Link href="/research#paid-research" prefetch={false} className={actionClass}>{copy("pricing.checkout")}</Link>
        </section>
        <section className="border border-line p-6">
          <h2 className="font-display text-2xl">{copy("pricing.creatorTitle")}</h2>
          <p className="mt-4 font-serif leading-relaxed text-ink-2">{copy("pricing.creatorBody")}</p>
          <Link href="/register" className={actionClass}>{copy("pricing.creatorTitle")}</Link>
        </section>
      </div>
      <nav className="mt-6 flex flex-wrap gap-x-6" aria-label={copy("product.about")}>
        <Link href="/about" className={actionClass}>{copy("product.about")}</Link>
        <Link href="/terms" className={actionClass}>{copy("product.terms")}</Link>
        <Link href="/privacy" className={actionClass}>{copy("product.privacy")}</Link>
      </nav>
    </main>
    <SiteFooter />
  </div>;
}
