import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { LiteratureReviewMatrix } from "@/components/keryx/literature-review-matrix";
import { UiText } from "@/lib/i18n/ui-copy";
import { safeInlineJson } from "@/lib/safe-json";
import { guideBase, guideBreadcrumbs, researchPageMetadata } from "@/lib/research-tools/guide-metadata";
import { researchGuidesCopy as copy } from "@/locales/en/research-guides";

export const metadata = researchPageMetadata("/tools/literature-review-matrix", copy.tool.title, copy.tool.description);
const text = (value: string) => <UiText source={value} namespaces={["research-guides"]} />;

export default function LiteratureMatrixPage() {
  const base = guideBase();
  const schema = { "@context": "https://schema.org", "@type": "WebApplication", name: copy.tool.title, description: copy.tool.description,
    url: `${base}/tools/literature-review-matrix`, inLanguage: "en", applicationCategory: "EducationalApplication", operatingSystem: "Web browser",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, browserRequirements: "Requires JavaScript for editing and CSV export" };
  return <div className="min-h-screen bg-paper-2">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeInlineJson([schema, guideBreadcrumbs(copy.tool.title)]) }} />
    <SiteHeader />
    <main lang="en" className="mx-auto max-w-[1000px] px-4 py-12 sm:px-[30px]">
      <Link href="/guides" className="inline-flex min-h-11 items-center font-mono text-xs text-seal underline underline-offset-4">{text(copy.allGuides)}</Link>
      <h1 className="mt-4 font-display text-[clamp(32px,5vw,50px)] leading-tight text-ink">{text(copy.tool.title)}</h1>
      <p className="mt-5 max-w-[75ch] font-serif text-xl leading-relaxed text-ink-2">{text(copy.tool.intro)}</p>
      <p className="mt-4 max-w-[85ch] font-serif text-sm leading-relaxed text-ink-3">{text(copy.tool.scopeNotice)}</p>
      <LiteratureReviewMatrix />
      <noscript><p className="mt-5 font-serif text-ink-2">{copy.tool.noScript}</p>
        <a href="/tools/literature-review-matrix/template.csv" download className="inline-flex min-h-11 items-center font-serif text-seal underline">{copy.tool.template}</a>
      </noscript>
      <section className="mt-10 max-w-[75ch]">
        <h2 className="font-display text-3xl text-ink">{text(copy.tool.howTitle)}</h2>
        <ol className="mt-5 list-decimal space-y-3 pl-5 font-serif text-lg leading-relaxed text-ink-2">{copy.tool.steps.map(step => <li key={step}>{text(step)}</li>)}</ol>
        <Link href="/guides/literature-review-matrix" className="mt-5 inline-flex min-h-11 items-center font-serif text-seal underline underline-offset-4">{text(copy.tool.guideAction)}</Link>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
