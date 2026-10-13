import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Globe, Monitor, Puzzle, Plug, Code, Terminal, MessagesSquare } from "lucide-react";
import { SetupGuide, SetupSteps, setupLinkClass } from "@/components/keryx/setup-guide";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { setupCopy as copy } from "@/locales/en/get-started";

export const metadata: Metadata = {
  title: copy.start.metadata, description: copy.start.description,
  alternates: englishPublicAlternates("/get-started"),
  openGraph: { title: copy.start.metadata, description: copy.start.description, url: "/get-started" },
};
const icons = { web: Globe, desktop: Monitor, extension: Puzzle, mcp: Plug, api: Code, cli: Terminal, bots: MessagesSquare };

export default function GetStartedPage() {
  return <SetupGuide current="/get-started" title={copy.start.title} body={copy.start.body}>
    <div className="mb-10 flex flex-wrap gap-3">
      <Link href="/#dispatch" className="inline-flex min-h-11 items-center border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper">{copy.start.try}<ArrowUpRight size={16} className="ml-3" aria-hidden="true" /></Link>
      <Link href="/download" className="inline-flex min-h-11 items-center border border-ink px-5 py-3 font-mono text-sm">{copy.start.browse}</Link>
    </div>
    <section aria-labelledby="choose-keryx">
      <h2 id="choose-keryx" className="font-display text-3xl">{copy.start.choose}</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {copy.surfaces.map(surface => {
          const Icon = icons[surface.id];
          return <article key={surface.id} className="flex min-w-0 flex-col border border-line bg-paper p-6">
            <div className="flex items-center gap-3"><Icon size={22} className="shrink-0 text-seal" aria-hidden="true" /><span className="font-mono text-[11px] text-ink-3">{surface.tag}</span></div>
            <h3 className="mt-4 font-display text-2xl">{surface.title}</h3>
            <p className="mt-3 font-serif leading-relaxed text-ink-2">{surface.body}</p>
            <p className="mb-4 mt-3 flex-1 font-serif text-sm leading-relaxed text-ink-3">{surface.detail}</p>
            <Link href={surface.href} className={setupLinkClass}>{surface.action}<ArrowUpRight size={14} aria-hidden="true" /></Link>
          </article>;
        })}
      </div>
    </section>
    <section className="mt-10 border border-paid bg-paper p-6 sm:p-8" aria-labelledby="first-answer">
      <h2 id="first-answer" className="font-display text-3xl">{copy.start.firstTitle}</h2>
      <p className="mt-3 max-w-[76ch] font-serif leading-relaxed text-ink-2">{copy.start.firstBody}</p>
      <SetupSteps steps={copy.start.steps} />
    </section>
    <section className="mt-10">
      <h2 className="font-display text-2xl">{copy.start.accountTitle}</h2>
      <p className="mt-3 max-w-[76ch] font-serif leading-relaxed text-ink-2">{copy.start.accountBody}</p>
      <Link href="/connect" className={setupLinkClass}>{copy.start.accountAction}</Link>
    </section>
    <section className="mt-10" aria-labelledby="setup-faq">
      <h2 id="setup-faq" className="font-display text-3xl">{copy.start.faqTitle}</h2>
      <div className="mt-4 border-y border-line">
        {copy.start.faq.map(faq => <details key={faq.question} className="border-b border-line last:border-b-0">
          <summary className="min-h-11 cursor-pointer py-4 font-serif text-lg">{faq.question}</summary>
          <p className="max-w-[76ch] pb-5 font-serif leading-relaxed text-ink-2">{faq.answer}</p>
        </details>)}
      </div>
    </section>
  </SetupGuide>;
}
