import type { Metadata } from "next";
import Link from "next/link";
import { SetupGuide, SetupSteps, setupLinkClass } from "@/components/keryx/setup-guide";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { installationLinks as links } from "@/lib/public-installation";
import { setupCopy as copy } from "@/locales/en/get-started";
import { UiText } from "@/lib/i18n/ui-copy";



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
        <p className="font-mono text-xs text-seal"><UiText source={copy.download.desktopTag} namespaces={["get-started"]} /></p>
        <h2 id="desktop-title" className="mt-3 font-display text-3xl"><UiText source={copy.download.desktopTitle} namespaces={["get-started"]} /></h2>
        <p className="mt-3 font-serif leading-relaxed text-ink-2"><UiText source={copy.download.desktopBody} namespaces={["get-started"]} /></p>
        <a href={links.installer} className="mt-5 inline-flex min-h-11 items-center border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper"><UiText source={copy.download.installer} namespaces={["get-started"]} /></a>
        <p className="mt-3 font-mono text-xs text-ink-3"><UiText source={copy.download.desktopVersion} namespaces={["get-started"]} /></p>
        <div className="mt-2 flex flex-wrap gap-x-5">
          <a href={links.portable} className={setupLinkClass}><UiText source={copy.download.portable} namespaces={["get-started"]} /></a>
          <a href={links.release} className={setupLinkClass}><UiText source={copy.common.release} namespaces={["get-started"]} /></a>
          <a href={links.manifest} className={setupLinkClass}><UiText source={copy.download.manifest} namespaces={["get-started"]} /></a>
        </div>
        <h3 className="mt-6 font-display text-xl"><UiText source={copy.common.requirements} namespaces={["get-started"]} /></h3>
        <p className="mt-2 font-serif leading-relaxed text-ink-2"><UiText source={copy.download.desktopRequirements} namespaces={["get-started"]} /></p>
        <a href={links.webview} className={setupLinkClass}><UiText source={copy.download.webview} namespaces={["get-started"]} /></a>
        <h3 className="mt-6 font-display text-xl"><UiText source={copy.common.steps} namespaces={["get-started"]} /></h3>
        <SetupSteps steps={copy.download.desktopSteps} />
        <p className="mt-5 border-l-2 border-seal pl-4 font-serif text-sm leading-relaxed text-ink-2"><UiText source={copy.download.desktopBoundary} namespaces={["get-started"]} /></p>
        <a href={`${links.docs}desktop-alpha.md`} className={`${setupLinkClass} mt-3`}><UiText source={copy.common.docs} namespaces={["get-started"]} /></a>
      </section>
      <section id="extension" className={sectionClass} aria-labelledby="extension-title">
        <p className="font-mono text-xs text-seal"><UiText source={copy.download.extensionTag} namespaces={["get-started"]} /></p>
        <h2 id="extension-title" className="mt-3 font-display text-3xl"><UiText source={copy.download.extensionTitle} namespaces={["get-started"]} /></h2>
        <p className="mt-3 font-serif leading-relaxed text-ink-2"><UiText source={copy.download.extensionBody} namespaces={["get-started"]} /></p>
        <a href={links.extensionSource} className="mt-5 inline-flex min-h-11 items-center border border-ink bg-ink px-5 py-3 font-mono text-sm text-paper"><UiText source={copy.download.extensionDownload} namespaces={["get-started"]} /></a>
        <p className="mt-3 font-mono text-xs text-ink-3"><UiText source={copy.download.extensionVersion} namespaces={["get-started"]} /></p>
        <h3 className="mt-6 font-display text-xl"><UiText source={copy.common.requirements} namespaces={["get-started"]} /></h3>
        <p className="mt-2 font-serif leading-relaxed text-ink-2"><UiText source={copy.download.extensionRequirements} namespaces={["get-started"]} /></p>
        <h3 className="mt-6 font-display text-xl"><UiText source={copy.common.steps} namespaces={["get-started"]} /></h3>
        <SetupSteps steps={copy.download.extensionSteps} />
        <p className="mt-5 border-l-2 border-seal pl-4 font-serif text-sm leading-relaxed text-ink-2"><UiText source={copy.download.extensionBoundary} namespaces={["get-started"]} /></p>
        <a href="https://github.com/tang-vu/keryx/blob/main/extension/README.md" className={`${setupLinkClass} mt-3`}><UiText source={copy.common.docs} namespaces={["get-started"]} /></a>
      </section>
    </div>
    <section className="mt-10">
      <h2 className="font-display text-2xl"><UiText source={copy.download.alternativeTitle} namespaces={["get-started"]} /></h2>
      <p className="mt-3 max-w-[76ch] font-serif leading-relaxed text-ink-2"><UiText source={copy.download.alternativeBody} namespaces={["get-started"]} /></p>
      <div className="mt-3 flex flex-wrap gap-x-6">
        <Link href="/#dispatch" className={setupLinkClass}><UiText source={copy.start.try} namespaces={["get-started"]} /></Link>
        <Link href="/integrations" className={setupLinkClass}><UiText source={copy.navigation.integrations} namespaces={["get-started"]} /></Link>
      </div>
    </section>
  </SetupGuide>;
}
