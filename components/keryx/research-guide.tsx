import Link from "next/link";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { UiText } from "@/lib/i18n/ui-copy";
import { safeInlineJson } from "@/lib/safe-json";
import { guideBreadcrumbs, researchGuideJsonLd, type ResearchGuide as Guide } from "@/lib/research-tools/guide-metadata";
import { researchGuidesCopy as copy } from "@/locales/en/research-guides";

const text = (value: string) => <UiText source={value} namespaces={["research-guides"]} />;

export function ResearchGuide({ guide }: { guide: Guide }) {
  const references = guide.sections.flatMap(section => section.referenceUrl && section.referenceLabel ? [{ label: section.referenceLabel, url: section.referenceUrl }] : []);
  return <div className="min-h-screen bg-paper-2">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeInlineJson([researchGuideJsonLd(guide), guideBreadcrumbs(guide.title)]) }} />
    <SiteHeader />
    <main lang="en" className="mx-auto max-w-[1000px] px-4 py-10 sm:px-[30px]">
      <nav className="font-mono text-xs text-seal"><Link href="/guides" className="inline-flex min-h-11 items-center underline underline-offset-4">{text(copy.allGuides)}</Link></nav>
      <article>
        <header className="max-w-[780px]">
          <p className="mt-4 font-mono text-xs uppercase tracking-[0.16em] text-seal">{text(copy.kicker)}</p>
          <h1 className="mt-4 font-display text-[clamp(32px,5vw,52px)] leading-tight text-ink">{text(guide.title)}</h1>
          <p className="mt-6 border-l-2 border-seal pl-5 font-serif text-xl leading-relaxed text-ink">{text(guide.summary)}</p>
          <p className="mt-5 font-mono text-xs text-ink-3">{text(copy.author)} · <time dateTime="2026-10-21">{text(copy.dateLabel)}</time></p>
          <p className="mt-3 font-serif text-sm leading-relaxed text-ink-3">{text(copy.editorialNote)}</p>
          <Link href={guide.actionHref} className="mt-6 inline-flex min-h-11 items-center border border-ink bg-seal px-4 py-3 font-mono text-xs text-paper">{text(guide.action)}</Link>
        </header>
        <nav className="mt-10 border-y border-line py-5" aria-labelledby="guide-contents">
          <h2 id="guide-contents" className="font-mono text-xs uppercase tracking-widest text-ink-3">{text(copy.contents)}</h2>
          <ol className="mt-3 grid gap-3 font-serif text-seal sm:grid-cols-2">{guide.sections.map(section => <li key={section.id}><a href={`#${section.id}`} className="underline underline-offset-4">{text(section.title)}</a></li>)}</ol>
        </nav>
        <div className="max-w-[76ch]">{guide.sections.map(section => <section id={section.id} key={section.id} className="scroll-mt-24 pt-10">
          <h2 className="font-display text-3xl leading-tight text-ink">{text(section.title)}</h2>
          {section.paragraphs.map(paragraph => <p key={paragraph} className="mt-5 font-serif text-lg leading-[1.8] text-ink-2">{text(paragraph)}</p>)}
          {section.referenceUrl && section.referenceLabel && <a href={section.referenceUrl} className="mt-4 inline-block font-serif text-sm text-seal underline underline-offset-4">{text(section.referenceLabel)}</a>}
        </section>)}
          <section className="mt-10 border-t border-line pt-6"><h2 className="font-display text-2xl text-ink">{text(copy.sources)}</h2>
            <ul className="mt-4 space-y-3 font-serif text-seal">{references.map(reference => <li key={reference.url}><a href={reference.url} className="underline underline-offset-4">{text(reference.label)}</a></li>)}</ul>
          </section>
        </div>
      </article>
      <aside className="mt-12 border border-ink bg-paper p-6">
        <h2 className="font-display text-2xl text-ink">{text(copy.related)}</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <div><Link href="/literature" className="font-serif text-lg text-seal underline underline-offset-4">{text(copy.literatureAction)}</Link><p className="mt-3 font-serif text-ink-2">{text(copy.literatureDetail)}</p></div>
          <div><Link href="/" className="font-serif text-lg text-seal underline underline-offset-4">{text(copy.researchAction)}</Link><p className="mt-3 font-serif text-ink-2">{text(copy.researchDetail)}</p></div>
        </div>
        {copy.guides.filter(item => item.slug !== guide.slug).map(item => <Link key={item.slug} href={`/guides/${item.slug}`} className="mt-6 inline-flex min-h-11 items-center font-serif text-seal underline underline-offset-4">{text(item.title)}</Link>)}
      </aside>
    </main>
    <SiteFooter />
  </div>;
}
