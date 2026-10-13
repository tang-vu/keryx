import type { Metadata } from "next";
import Link from "next/link";
import { SetupGuide, SetupSteps, setupLinkClass } from "@/components/keryx/setup-guide";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { installationLinks as links } from "@/lib/public-installation";
import { setupCopy as copy } from "@/locales/en/get-started";

export const metadata: Metadata = {
  title: copy.download.metadata, description: copy.download.description,
  alternates: englishPublicAlternates("/download"),
  openGraph: { title: copy.download.metadata, description: copy.download.description, url: "/download" },
};
const sectionClass = "scroll-mt-28 border border-line bg-paper p-6 sm:p-8";

export default function DownloadPage() {
  return <SetupGuide current="/download" title={copy.download.title} body={copy.download.body}>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section id="desktop" className={sectionClass} aria-labelledby="desktop-title">
        <p className="font-mono text-xs text-seal">{copy.download.desktopTag}</p>
        <h2 id="desktop-title" className="mt-3 font-display text-3xl">{copy.download.desktopTitle}</h2>
        <p className="mt-3 font-serif leading-relaxed text-ink-2">{copy.download.desktopBody}</p>
        <a href={links.installer} className="mt-5 inline-flex min-h-11 items-center border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper">{copy.download.installer}</a>
        <p className="mt-3 font-mono text-xs text-ink-3">{copy.download.desktopVersion}</p>
        <div className="mt-2 flex flex-wrap gap-x-5">
          <a href={links.portable} className={setupLinkClass}>{copy.download.portable}</a>
          <a href={links.release} className={setupLinkClass}>{copy.common.release}</a>
          <a href={links.manifest} className={setupLinkClass}>{copy.download.manifest}</a>
        </div>
        <h3 className="mt-6 font-display text-xl">{copy.common.requirements}</h3>
        <p className="mt-2 font-serif leading-relaxed text-ink-2">{copy.download.desktopRequirements}</p>
        <a href={links.webview} className={setupLinkClass}>{copy.download.webview}</a>
        <h3 className="mt-6 font-display text-xl">{copy.common.steps}</h3>
        <SetupSteps steps={copy.download.desktopSteps} />
        <p className="mt-5 border-l-2 border-seal pl-4 font-serif text-sm leading-relaxed text-ink-2">{copy.download.desktopBoundary}</p>
        <a href={`${links.docs}desktop-alpha.md`} className={`${setupLinkClass} mt-3`}>{copy.common.docs}</a>
      </section>
      <section id="extension" className={sectionClass} aria-labelledby="extension-title">
        <p className="font-mono text-xs text-seal">{copy.download.extensionTag}</p>
        <h2 id="extension-title" className="mt-3 font-display text-3xl">{copy.download.extensionTitle}</h2>
        <p className="mt-3 font-serif leading-relaxed text-ink-2">{copy.download.extensionBody}</p>
        <a href={links.extensionSource} className="mt-5 inline-flex min-h-11 items-center border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper">{copy.download.extensionDownload}</a>
        <p className="mt-3 font-mono text-xs text-ink-3">{copy.download.extensionVersion}</p>
        <h3 className="mt-6 font-display text-xl">{copy.common.requirements}</h3>
        <p className="mt-2 font-serif leading-relaxed text-ink-2">{copy.download.extensionRequirements}</p>
        <h3 className="mt-6 font-display text-xl">{copy.common.steps}</h3>
        <SetupSteps steps={copy.download.extensionSteps} />
        <p className="mt-5 border-l-2 border-seal pl-4 font-serif text-sm leading-relaxed text-ink-2">{copy.download.extensionBoundary}</p>
        <a href="https://github.com/tang-vu/keryx/blob/main/extension/README.md" className={`${setupLinkClass} mt-3`}>{copy.common.docs}</a>
      </section>
    </div>
    <section className="mt-10">
      <h2 className="font-display text-2xl">{copy.download.alternativeTitle}</h2>
      <p className="mt-3 max-w-[76ch] font-serif leading-relaxed text-ink-2">{copy.download.alternativeBody}</p>
      <div className="mt-3 flex flex-wrap gap-x-6">
        <Link href="/#dispatch" className={setupLinkClass}>{copy.start.try}</Link>
        <Link href="/integrations" className={setupLinkClass}>{copy.navigation.integrations}</Link>
      </div>
    </section>
  </SetupGuide>;
}
