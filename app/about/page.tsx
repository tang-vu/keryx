import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { AboutResearchStory } from "@/components/keryx/about-research-story";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/public-support";
import { productGuideCopy as copy } from "@/locales/en/product-guide";
import { aboutStory as story, aboutStoryLinks } from "@/locales/en/about-story";
import { UiElement, UiText } from "@/lib/i18n/ui-copy";

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
        <p className="font-mono text-xs uppercase tracking-widest text-seal"><UiText source={copy("product.about")} namespaces={["product-guide","about-story"]} /></p>
        <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl"><UiText source={copy("about.title")} namespaces={["product-guide","about-story"]} /></h1>
        <p className="mt-5 max-w-[72ch] font-serif text-lg leading-relaxed text-ink-2"><UiText source={copy("about.introduction")} namespaces={["product-guide","about-story"]} /></p>
        <div lang="en" className="mt-7 flex flex-wrap items-center gap-3">
          <Link href="/walkthrough" prefetch={false} className="inline-flex min-h-11 items-center gap-3 border border-ink bg-ink px-5 py-3 font-mono text-xs text-paper transition-colors hover:bg-paid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paid"><UiText source={story.walkthrough} namespaces={["product-guide","about-story"]} /><span aria-hidden="true">→</span></Link>
          <a href={aboutStoryLinks.demo} className={`${linkClass} px-2`}><UiText source={story.demo} namespaces={["product-guide","about-story"]} /><span aria-hidden="true" className="ml-2">↗</span></a>
        </div>
      </div>
      <AboutResearchStory />
      <div className="mx-auto max-w-[960px] px-4 sm:px-[30px]">
        <div className="mt-8 space-y-8 font-serif leading-relaxed text-ink-2">
          <section>
            <h2 className="font-display text-2xl text-ink"><UiText source={copy("about.whyTitle")} namespaces={["product-guide","about-story"]} /></h2>
            <p className="mt-3"><UiText source={copy("about.whyBody")} namespaces={["product-guide","about-story"]} /></p>
          </section>
          <section>
            <h2 className="font-display text-2xl text-ink"><UiText source={copy("about.projectTitle")} namespaces={["product-guide","about-story"]} /></h2>
            <p className="mt-3"><UiText source={copy("about.projectBody")} namespaces={["product-guide","about-story"]} /></p>
            <p className="mt-3"><UiText source={copy("about.projectLegalNotice")} namespaces={["product-guide"]} /></p>
            <div className="mt-2 flex flex-wrap gap-x-6">
              <a href="https://github.com/tang-vu/keryx" className={linkClass}><UiText source={copy("about.github")} namespaces={["product-guide","about-story"]} /></a>
              <a href="https://github.com/tang-vu/keryx/issues" className={linkClass}><UiText source={copy("about.issues")} namespaces={["product-guide","about-story"]} /></a>
              <a href="https://github.com/tang-vu/keryx/blob/main/docs/licensing.md" className={linkClass}><UiText source={copy("about.projectLegalLink")} namespaces={["product-guide"]} /></a>
            </div>
          </section>
          <section id="contact" className="scroll-mt-24 border border-paid bg-paper p-6">
            <h2 className="font-display text-2xl text-ink"><UiText source={copy("about.contactTitle")} namespaces={["product-guide","about-story"]} /></h2>
            <p className="mt-3"><UiText source={copy("about.contactBody")} namespaces={["product-guide","about-story"]} /></p>
            <a href={SUPPORT_MAILTO} className={`${linkClass} mt-3 break-all font-mono text-sm`}>{SUPPORT_EMAIL}</a>
          </section>
          <section>
            <h2 className="font-display text-2xl text-ink"><UiText source={copy("about.boundariesTitle")} namespaces={["product-guide","about-story"]} /></h2>
            <p className="mt-3"><UiText source={copy("about.boundariesBody")} namespaces={["product-guide","about-story"]} /></p>
          </section>
        </div>
      </div>
      <UiElement as="nav" names={["aria-label"]} namespaces={["product-guide","about-story"]} attributes={{ "className": "mx-auto flex max-w-[960px] flex-wrap gap-x-6 px-4 py-10 sm:px-[30px]", "aria-label": copy("product.about") }}>
        <Link href="/#dispatch" className={linkClass}><UiText source={copy("product.try")} namespaces={["product-guide","about-story"]} /></Link>
        <Link href="/pricing" className={linkClass}><UiText source={copy("product.pricing")} namespaces={["product-guide","about-story"]} /></Link>
        <Link href="/privacy" className={linkClass}><UiText source={copy("product.privacy")} namespaces={["product-guide","about-story"]} /></Link>
        <Link href="/terms" className={linkClass}><UiText source={copy("product.terms")} namespaces={["product-guide","about-story"]} /></Link>
      </UiElement>
    </main>
    <SiteFooter />
  </div>;
}
