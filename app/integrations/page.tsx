import type { Metadata } from "next";
import Link from "next/link";
import { SetupGuide, SetupSteps, setupLinkClass } from "@/components/keryx/setup-guide";
import { SetupCode } from "@/components/keryx/setup-code";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { installationLinks as links, setupExamples } from "@/lib/public-installation";
import { setupCopy as copy } from "@/locales/en/get-started";

export const metadata: Metadata = {
  title: copy.integrations.metadata, description: copy.integrations.description,
  alternates: englishPublicAlternates("/integrations"),
  openGraph: { title: copy.integrations.metadata, description: copy.integrations.description, url: "/integrations" },
};
const sectionClass = "mt-10 scroll-mt-28 border-t border-line pt-8";
const bodyClass = "mt-3 max-w-[76ch] font-serif leading-relaxed text-ink-2";
const guide = copy.integrations;

export default function IntegrationsPage() {
  return <SetupGuide current="/integrations" title={guide.title} body={guide.body}>
    <nav aria-label={copy.navigation.integrations} className="flex flex-wrap gap-x-6 font-mono">
      {copy.surfaces.filter(surface => ["mcp", "api", "cli", "bots"].includes(surface.id)).map(surface => <a key={surface.id} href={`#${surface.id}`} className={setupLinkClass}>{surface.title}</a>)}
    </nav>
    <section id="mcp" className={sectionClass} aria-labelledby="mcp-title">
      <h2 id="mcp-title" className="font-display text-3xl">{guide.mcpTitle}</h2>
      <p className={bodyClass}>{guide.mcpBody}</p>
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <article className="min-w-0 border border-line bg-paper p-6">
          <h3 className="font-display text-2xl">{guide.remoteTitle}</h3>
          <p className={bodyClass}>{guide.remoteBody}</p>
          <SetupCode title={guide.remoteEndpoint} value={setupExamples.remoteEndpoint} />
          <p className={bodyClass}>{guide.remoteStep}</p>
          <Link href="/integrations/mcp" className={`${setupLinkClass} mt-3`}>{guide.remoteAction}</Link>
        </article>
        <article className="min-w-0 border border-line bg-paper p-6">
          <h3 className="font-display text-2xl">{guide.stdioTitle}</h3>
          <p className={bodyClass}>{guide.stdioBody}</p>
          <h4 className="mt-4 font-display text-xl">{copy.common.requirements}</h4>
          <p className={bodyClass}>{guide.stdioRequirements}</p>
          <SetupCode title={guide.stdioConfig} value={setupExamples.stdio} />
          <p className={bodyClass}>{guide.stdioStep}</p>
          <div className="mt-3 flex flex-wrap gap-x-5">
            <a href="https://github.com/tang-vu/keryx/blob/main/mcp/README.md" className={setupLinkClass}>{guide.stdioGuide}</a>
            <a href={links.npm} className={setupLinkClass}>{guide.stdioPackage}</a>
          </div>
        </article>
      </div>
    </section>
    <section id="api" className={sectionClass} aria-labelledby="api-title">
      <h2 id="api-title" className="font-display text-3xl">{guide.apiTitle}</h2>
      <p className={bodyClass}>{guide.apiBody}</p>
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <article className="min-w-0 border border-line bg-paper p-6">
          <h3 className="font-display text-2xl">{guide.apiConfigTitle}</h3>
          <dl className="mt-4 font-mono text-xs leading-relaxed">
            <dt className="text-ink-3">{guide.apiBase}</dt><dd className="mt-1 break-all">{setupExamples.apiBase}</dd>
            <dt className="mt-3 text-ink-3">{guide.apiModel}</dt><dd className="mt-1">{setupExamples.model}</dd>
          </dl>
          <SetupSteps steps={guide.apiSteps} />
          <div className="mt-3 flex flex-wrap gap-x-5">
            <Link href="/dev" className={setupLinkClass}>{guide.apiKeys}</Link>
            <a href="/api/docs" className={setupLinkClass}>{guide.apiReference}</a>
            <a href={`${links.docs}openai-compatible-api.md`} className={setupLinkClass}>{guide.apiRecipes}</a>
          </div>
        </article>
        <div className="min-w-0">
          <SetupCode title={guide.apiReadOnly} value={setupExamples.models} />
          <SetupCode title={guide.apiExample} value={setupExamples.chat} />
          <p className="mt-3 font-serif text-sm leading-relaxed text-ink-2">{guide.apiExampleNotice}</p>
        </div>
      </div>
      <article className="mt-5 border-l-2 border-paid bg-paper p-6">
        <h3 className="font-display text-2xl">{guide.a2aTitle}</h3>
        <p className={bodyClass}>{guide.a2aBody}</p>
        <Link href="/research#paid-research" className={`${setupLinkClass} mt-3`}>{guide.a2aAction}</Link>
      </article>
    </section>
    <section id="cli" className={sectionClass} aria-labelledby="cli-title">
      <h2 id="cli-title" className="font-display text-3xl">{guide.cliTitle}</h2>
      <p className={bodyClass}>{guide.cliBody}</p>
      <h3 className="mt-4 font-display text-xl">{copy.common.requirements}</h3>
      <p className={bodyClass}>{guide.cliRequirements}</p>
      <p className={bodyClass}>{guide.cliBoundary}</p>
      <SetupCode title={guide.cliSetup} value={setupExamples.cli} />
      <div className="mt-3 flex flex-wrap gap-x-6">
        <a href="https://github.com/tang-vu/keryx#run-it" className={setupLinkClass}>{guide.cliGuide}</a>
        <a href={`${links.docs}buyer-agent.md`} className={setupLinkClass}>{guide.cliBuyer}</a>
      </div>
    </section>
    <section id="bots" className={sectionClass} aria-labelledby="bots-title">
      <h2 id="bots-title" className="font-display text-3xl">{guide.botsTitle}</h2>
      <p className={bodyClass}>{guide.botsBody}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {[
          { title: guide.telegram, body: guide.telegramBody, action: guide.telegramAction, href: links.telegram, docs: "telegram-bot-setup.md" },
          { title: guide.discord, body: guide.discordBody, action: guide.discordAction, href: links.discord, docs: "discord-bot-setup.md" },
          { title: guide.slack, body: guide.slackBody, action: guide.slackAction, href: `${links.docs}slack-bot-setup.md`, docs: null },
        ].map(bot => <article key={bot.title} className="flex flex-col border border-line bg-paper p-6">
          <h3 className="font-display text-2xl">{bot.title}</h3>
          <p className="mb-3 mt-3 flex-1 font-serif leading-relaxed text-ink-2">{bot.body}</p>
          <a href={bot.href} className={setupLinkClass}>{bot.action}</a>
          {bot.docs && <a href={`${links.docs}${bot.docs}`} className={setupLinkClass}>{guide.selfHost}</a>}
        </article>)}
      </div>
    </section>
  </SetupGuide>;
}
