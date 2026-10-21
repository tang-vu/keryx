import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { UiText } from "@/lib/i18n/ui-copy";
import { researchPageMetadata, guideBase } from "@/lib/research-tools/guide-metadata";
import { safeInlineJson } from "@/lib/safe-json";
import { researchGuidesCopy as copy } from "@/locales/en/research-guides";

export const metadata = researchPageMetadata("/guides", copy.hubTitle, copy.hubDescription);
const text = (value: string) => <UiText source={value} namespaces={["research-guides"]} />;

export default function GuidesPage() {
  const base = guideBase();
  const schema = { "@context": "https://schema.org", "@type": "CollectionPage", name: copy.hubTitle, description: copy.hubDescription,
    url: `${base}/guides`, inLanguage: "en", mainEntity: { "@type": "ItemList", itemListElement: copy.guides.map((guide, i) => ({
      "@type": "ListItem", position: i + 1, name: guide.title, url: `${base}/guides/${guide.slug}` })) } };
  return <div className="min-h-screen bg-paper-2">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeInlineJson(schema) }} />
    <SiteHeader />
    <main lang="en" className="mx-auto max-w-[1000px] px-4 py-12 sm:px-[30px]">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">{text(copy.kicker)}</p>
      <h1 className="mt-4 max-w-[24ch] font-display text-[clamp(34px,5vw,54px)] leading-tight text-ink">{text(copy.hubTitle)}</h1>
      <p className="mt-5 max-w-[70ch] font-serif text-xl leading-relaxed text-ink-2">{text(copy.hubIntro)}</p>
      <Link href="/tools/literature-review-matrix" className="mt-8 block border border-ink bg-paper p-6 transition-colors hover:bg-panel">
        <h2 className="font-display text-3xl text-ink">{text(copy.tool.title)}</h2><p className="mt-3 max-w-[72ch] font-serif text-lg leading-relaxed text-ink-2">{text(copy.tool.description)}</p>
      </Link>
      <div className="mt-6 grid gap-6 md:grid-cols-2">{copy.guides.map(guide => <article key={guide.slug} className="flex flex-col border border-line bg-paper p-6">
        <h2 className="font-display text-2xl leading-tight text-ink"><Link href={`/guides/${guide.slug}`} className="hover:text-seal">{text(guide.title)}</Link></h2>
        <p className="mb-5 mt-4 font-serif leading-relaxed text-ink-2">{text(guide.description)}</p>
        <Link href={`/guides/${guide.slug}`} className="mt-auto inline-flex min-h-11 items-center font-mono text-xs text-seal underline underline-offset-4">{text(copy.readGuide)}</Link>
      </article>)}</div>
    </main>
    <SiteFooter />
  </div>;
}
