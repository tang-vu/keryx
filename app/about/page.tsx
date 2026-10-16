import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { AboutResearchStory } from "@/components/keryx/about-research-story";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/public-support";
import { productGuideCopy as copy } from "@/locales/en/product-guide";
import { aboutStory as story, aboutStoryLinks } from "@/locales/en/about-story";

export const metadata: Metadata = {
  title: copy("about.metadataTitle"),
  description: copy("about.description"),
  alternates: englishPublicAlternates("/about"),
  openGraph: { title: copy("about.metadataTitle"), description: copy("about.description"), url: "/about" },
  twitter: { title: copy("about.metadataTitle"), description: copy("about.description") },
};

const linkClass = "inline-flex min-h-11 items-center text-paid underline underline-offset-4";

export default function AboutPage() {
  return <div className="min-h-screen bg-paper-2">
    <SiteHeader />
    <main>
      <div className="mx-auto max-w-[960px] px-4 pt-12 sm:px-[30px]">
        <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy("product.about")}</p>
        <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{copy("about.title")}</h1>
        <p className="mt-5 max-w-[72ch] font-serif text-lg leading-relaxed text-ink-2">{copy("about.introduction")}</p>
        <div lang="en" className="mt-7 flex flex-wrap items-center gap-3">
          <Link href="/walkthrough" prefetch={false} className="inline-flex min-h-11 items-center gap-3 border border-ink bg-ink px-5 py-3 font-mono text-xs text-paper transition-colors hover:bg-paid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paid">{story.walkthrough}<span aria-hidden="true">→</span></Link>
          <a href={aboutStoryLinks.demo} className={`${linkClass} px-2`}>{story.demo}<span aria-hidden="true" className="ml-2">↗</span></a>
        </div>
      </div>
      <AboutResearchStory />
      <div className="mx-auto max-w-[960px] px-4 sm:px-[30px]">
        <div className="mt-8 space-y-8 font-serif leading-relaxed text-ink-2">
          <section>
            <h2 className="font-display text-2xl text-ink">{copy("about.whyTitle")}</h2>
            <p className="mt-3">{copy("about.whyBody")}</p>
          </section>
          <section>
            <h2 className="font-display text-2xl text-ink">{copy("about.projectTitle")}</h2>
            <p className="mt-3">{copy("about.projectBody")}</p>
            <div className="mt-2 flex flex-wrap gap-x-6">
              <a href="https://github.com/tang-vu/keryx" className={linkClass}>{copy("about.github")}</a>
              <a href="https://github.com/tang-vu/keryx/issues" className={linkClass}>{copy("about.issues")}</a>
            </div>
          </section>
          <section id="contact" className="scroll-mt-24 border border-paid bg-paper p-6">
            <h2 className="font-display text-2xl text-ink">{copy("about.contactTitle")}</h2>
            <p className="mt-3">{copy("about.contactBody")}</p>
            <a href={SUPPORT_MAILTO} className={`${linkClass} mt-3 break-all font-mono text-sm`}>{SUPPORT_EMAIL}</a>
          </section>
          <section>
            <h2 className="font-display text-2xl text-ink">{copy("about.boundariesTitle")}</h2>
            <p className="mt-3">{copy("about.boundariesBody")}</p>
          </section>
        </div>
      </div>
      <nav className="mx-auto flex max-w-[960px] flex-wrap gap-x-6 px-4 py-10 sm:px-[30px]" aria-label={copy("product.about")}>
        <Link href="/#dispatch" className={linkClass}>{copy("product.try")}</Link>
        <Link href="/pricing" className={linkClass}>{copy("product.pricing")}</Link>
        <Link href="/privacy" className={linkClass}>{copy("product.privacy")}</Link>
        <Link href="/terms" className={linkClass}>{copy("product.terms")}</Link>
      </nav>
    </main>
    <SiteFooter />
  </div>;
}
