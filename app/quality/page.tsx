import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { QualityScorecard } from "@/components/keryx/quality-scorecard";
import { frozenPublicQualityScorecards } from "@/lib/evals/frozen-public-quality-scorecards";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { qualityMessages as copy } from "@/locales/en/quality";
import { UiText } from "@/lib/i18n/ui-copy";



export const metadata: Metadata = {
  title: copy.metadataTitle, description: copy.metadataDescription,
  alternates: englishPublicAlternates("/quality"),
  openGraph: { title: copy.metadataTitle, description: copy.metadataDescription, url: "/quality", type: "website" },
  twitter: { card: "summary", title: copy.metadataTitle, description: copy.metadataDescription },
};

export default function QualityPage() {
  const [latest, ...historical] = frozenPublicQualityScorecards();
  return <div className="min-h-screen bg-paper-2">
    <SiteHeader />
    <main className="mx-auto max-w-[980px] px-4 pb-20 pt-12 sm:px-[30px]">
      <p className="font-mono text-xs uppercase tracking-widest text-seal"><UiText source={copy.eyebrow} namespaces={["quality"]} /></p>
      <h1 className="mt-2 font-display text-[clamp(34px,6vw,58px)] leading-tight text-ink"><UiText source={copy.title} namespaces={["quality"]} /></h1>
      <p className="mt-5 max-w-[75ch] font-serif text-lg leading-relaxed text-ink-2"><UiText source={copy.introduction} namespaces={["quality"]} /></p>
      <p className="mt-4 max-w-[80ch] text-sm leading-relaxed text-ink-2"><UiText source={copy.trend} namespaces={["quality"]} /></p>
      <section className="mt-6 border border-line bg-paper p-5">
        <h2 className="font-display text-2xl"><UiText source={copy.rubricTitle} namespaces={["quality"]} /></h2>
        <p className="mt-3 text-sm leading-relaxed"><UiText source={copy.rubric} namespaces={["quality"]} /></p>
        <p className="mt-3 text-sm leading-relaxed text-ink-2"><UiText source={copy.provenanceLimit} namespaces={["quality"]} /></p>
        <p className="mt-3 text-sm leading-relaxed text-ink-2"><UiText source={copy.privacy} namespaces={["quality"]} /></p>
      </section>
      <QualityScorecard {...latest} />
      <section className="mt-8"><h2 className="font-display text-2xl"><UiText source={copy.history} namespaces={["quality"]} /></h2>
        {historical.map(snapshot => <details key={snapshot.id} className="mt-4">
          <summary className="cursor-pointer text-paid"><UiText source={copy.snapshots[snapshot.id]} namespaces={["quality"]} /></summary>
          <QualityScorecard {...snapshot} />
        </details>)}
      </section>
      <section className="mt-8 border border-line p-5">
        <h2 className="font-display text-2xl"><UiText source={copy.gatesTitle} namespaces={["quality"]} /></h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">{copy.gates.map(gate => <li key={gate}><UiText source={gate} namespaces={["quality"]} /></li>)}</ul>
        <a className="mt-4 inline-block text-paid underline underline-offset-4" href="https://github.com/tang-vu/keryx/issues/287"><UiText source={copy.issueLink} namespaces={["quality"]} /></a>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
