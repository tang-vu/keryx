import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Globe, Monitor, Puzzle, Plug, Code, Terminal, MessagesSquare } from "lucide-react";
import { SetupGuide, SetupSteps, setupLinkClass } from "@/components/keryx/setup-guide";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { setupCopy as copy } from "@/locales/en/get-started";
import { UiText } from "@/lib/i18n/ui-copy";



export const metadata: Metadata = {
  title: copy.start.metadata, description: copy.start.description,
  alternates: englishPublicAlternates("/get-started"),
  openGraph: { title: copy.start.metadata, description: copy.start.description, url: "/get-started" },
};
const icons = { web: Globe, desktop: Monitor, extension: Puzzle, mcp: Plug, api: Code, cli: Terminal, bots: MessagesSquare };

export default function GetStartedPage() {
  return <SetupGuide current="/get-started" title={copy.start.title} body={copy.start.body}>
    <div className="mb-10 flex flex-wrap gap-3">
      <Link href="/#dispatch" className="inline-flex min-h-11 items-center border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper"><UiText source={copy.start.try} namespaces={["get-started"]} /><ArrowUpRight size={16} className="ml-3" aria-hidden="true" /></Link>
      <Link href="/download" className="inline-flex min-h-11 items-center border border-ink px-5 py-3 font-mono text-sm"><UiText source={copy.start.browse} namespaces={["get-started"]} /></Link>
    </div>
    <section aria-labelledby="choose-keryx">
      <h2 id="choose-keryx" className="font-display text-3xl"><UiText source={copy.start.choose} namespaces={["get-started"]} /></h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {copy.surfaces.map(surface => {
          const Icon = icons[surface.id];
          return <article key={surface.id} className="flex min-w-0 flex-col border border-line bg-paper p-6">
            <div className="flex items-center gap-3"><Icon size={22} className="shrink-0 text-seal" aria-hidden="true" /><span className="font-mono text-[11px] text-ink-3"><UiText source={surface.tag} namespaces={["get-started"]} /></span></div>
            <h3 className="mt-4 font-display text-2xl"><UiText source={surface.title} namespaces={["get-started"]} /></h3>
            <p className="mt-3 font-serif leading-relaxed text-ink-2"><UiText source={surface.body} namespaces={["get-started"]} /></p>
            <p className="mb-4 mt-3 flex-1 font-serif text-sm leading-relaxed text-ink-3"><UiText source={surface.detail} namespaces={["get-started"]} /></p>
            <Link href={surface.href} className={setupLinkClass}><UiText source={surface.action} namespaces={["get-started"]} /><ArrowUpRight size={14} aria-hidden="true" /></Link>
          </article>;
        })}
      </div>
    </section>
    <section className="mt-10 border border-paid bg-paper p-6 sm:p-8" aria-labelledby="first-answer">
      <h2 id="first-answer" className="font-display text-3xl"><UiText source={copy.start.firstTitle} namespaces={["get-started"]} /></h2>
      <p className="mt-3 max-w-[76ch] font-serif leading-relaxed text-ink-2"><UiText source={copy.start.firstBody} namespaces={["get-started"]} /></p>
      <SetupSteps steps={copy.start.steps} />
    </section>
    <section className="mt-10">
      <h2 className="font-display text-2xl"><UiText source={copy.start.accountTitle} namespaces={["get-started"]} /></h2>
      <p className="mt-3 max-w-[76ch] font-serif leading-relaxed text-ink-2"><UiText source={copy.start.accountBody} namespaces={["get-started"]} /></p>
      <Link href="/connect" className={setupLinkClass}><UiText source={copy.start.accountAction} namespaces={["get-started"]} /></Link>
    </section>
    <section className="mt-10" aria-labelledby="setup-faq">
      <h2 id="setup-faq" className="font-display text-3xl"><UiText source={copy.start.faqTitle} namespaces={["get-started"]} /></h2>
      <div className="mt-4 border-y border-line">
        {copy.start.faq.map(faq => <details key={faq.question} className="border-b border-line last:border-b-0">
          <summary className="min-h-11 cursor-pointer py-4 font-serif text-lg"><UiText source={faq.question} namespaces={["get-started"]} /></summary>
          <p className="max-w-[76ch] pb-5 font-serif leading-relaxed text-ink-2"><UiText source={faq.answer} namespaces={["get-started"]} /></p>
        </details>)}
      </div>
    </section>
  </SetupGuide>;
}
