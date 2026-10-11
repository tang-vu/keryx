import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { QualityScorecard } from "@/components/keryx/quality-scorecard";
import { frozenPublicQualityScorecards } from "@/lib/evals/frozen-public-quality-scorecards";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { qualityMessages as copy } from "@/locales/en/quality";

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
      <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy.eyebrow}</p>
      <h1 className="mt-2 font-display text-[clamp(34px,6vw,58px)] leading-tight text-ink">{copy.title}</h1>
      <p className="mt-5 max-w-[75ch] font-serif text-lg leading-relaxed text-ink-2">{copy.introduction}</p>
      <p className="mt-4 max-w-[80ch] text-sm leading-relaxed text-ink-2">{copy.trend}</p>
      <section className="mt-6 border border-line bg-paper p-5">
        <h2 className="font-display text-2xl">{copy.rubricTitle}</h2>
        <p className="mt-3 text-sm leading-relaxed">{copy.rubric}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{copy.provenanceLimit}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{copy.privacy}</p>
      </section>
      <QualityScorecard {...latest} />
      <section className="mt-8"><h2 className="font-display text-2xl">{copy.history}</h2>
        {historical.map(snapshot => <details key={snapshot.id} className="mt-4">
          <summary className="cursor-pointer text-paid">{copy.snapshots[snapshot.id]}</summary>
          <QualityScorecard {...snapshot} />
        </details>)}
      </section>
      <section className="mt-8 border border-line p-5">
        <h2 className="font-display text-2xl">{copy.gatesTitle}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">{copy.gates.map(gate => <li key={gate}>{gate}</li>)}</ul>
        <a className="mt-4 inline-block text-paid underline underline-offset-4" href="https://github.com/tang-vu/keryx/issues/287">{copy.issueLink}</a>
      </section>
    </main>
    <SiteFooter />
  </div>;
}
