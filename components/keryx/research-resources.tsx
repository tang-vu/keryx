import Link from "next/link";
import { researchGuidesCopy as copy } from "@/locales/en/research-guides";
import { UiText } from "@/lib/i18n/ui-copy";

const text = (value: string) => <UiText source={value} namespaces={["research-guides"]} />;

export function ResearchResources() {
  return <section lang="en" className="mx-auto max-w-[960px] px-4 py-12 sm:px-[30px]" aria-labelledby="research-resources-heading">
    <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">{text(copy.kicker)}</p>
    <h2 id="research-resources-heading" className="mt-3 font-display text-3xl text-ink">{text(copy.homeTitle)}</h2>
    <p className="mt-4 max-w-[65ch] font-serif text-lg text-ink-2">{text(copy.homeIntro)}</p>
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <Link href="/tools/literature-review-matrix" className="border border-ink bg-paper p-5 transition-colors hover:bg-panel">
        <h3 className="font-display text-2xl text-ink">{text(copy.tool.title)}</h3><p className="mt-3 font-serif leading-relaxed text-ink-2">{text(copy.tool.description)}</p>
      </Link>
      <Link href="/guides/verify-ai-citations" className="border border-line bg-paper p-5 transition-colors hover:bg-panel">
        <h3 className="font-display text-2xl text-ink">{text(copy.guides[1].title)}</h3><p className="mt-3 font-serif leading-relaxed text-ink-2">{text(copy.guides[1].description)}</p>
      </Link>
    </div>
    <Link href="/guides" className="mt-5 inline-flex min-h-11 items-center font-mono text-xs text-seal underline underline-offset-4">{text(copy.allGuides)}</Link>
  </section>;
}
