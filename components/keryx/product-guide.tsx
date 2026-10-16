import Link from "next/link";
import { productGuideCopy as copy } from "@/locales/en/product-guide";
import { setupCopy } from "@/locales/en/get-started";
import { UiElement, UiText } from "@/lib/i18n/ui-copy";



const linkClass = "inline-flex min-h-11 items-center font-mono text-xs text-paid underline underline-offset-4";

export function ProductOverview() {
  const audiences = [
    { title: copy("product.researchersTitle"), body: copy("product.researchersBody"), action: copy("product.researchersAction"), href: "/literature" },
    { title: copy("product.buildersTitle"), body: copy("product.buildersBody"), action: copy("product.buildersAction"), href: "/sources" },
    { title: copy("product.agentsTitle"), body: copy("product.agentsBody"), action: copy("product.agentsAction"), href: "/integrations" },
  ];
  return <section className="mx-auto max-w-[1180px] px-4 pt-10 sm:px-[30px]" aria-labelledby="product-overview">
    <p className="font-mono text-xs uppercase tracking-widest text-seal"><UiText source={copy("product.overviewKicker")} namespaces={["product-guide","get-started"]} /></p>
    <h2 id="product-overview" className="mt-3 max-w-[30ch] font-display text-3xl leading-tight sm:text-4xl"><UiText source={copy("product.overviewTitle")} namespaces={["product-guide","get-started"]} /></h2>
    <p className="mt-4 max-w-[76ch] font-serif text-lg leading-relaxed text-ink-2"><UiText source={copy("product.overviewBody")} namespaces={["product-guide","get-started"]} /></p>
    <Link className={`${linkClass} mt-3`} href="/briefs"><UiText source={copy("product.briefsAction")} namespaces={["product-guide","get-started"]} /></Link>
    <div className="mt-6 grid gap-4 md:grid-cols-3">
      {audiences.map(audience => <article key={audience.href} className="flex flex-col border border-line bg-paper p-6">
        <h3 className="font-display text-2xl"><UiText source={audience.title} /></h3>
        <p className="mb-3 mt-3 flex-1 font-serif leading-relaxed text-ink-2"><UiText source={audience.body} /></p>
        <Link className={linkClass} href={audience.href}><UiText source={audience.action} /></Link>
      </article>)}
    </div>
  </section>;
}

export function ProductSetupEntry() {
  return <section className="mx-auto max-w-[1180px] px-4 pt-8 sm:px-[30px]" aria-labelledby="product-setup">
    <div className="border-y border-line py-6 sm:flex sm:items-center sm:justify-between sm:gap-8">
      <div>
        <h2 id="product-setup" className="font-display text-2xl"><UiText source={setupCopy.navigation.label} namespaces={["product-guide","get-started"]} /></h2>
        <p className="mt-2 max-w-[64ch] font-serif leading-relaxed text-ink-2"><UiText source={setupCopy.navigation.entryBody} namespaces={["product-guide","get-started"]} /></p>
      </div>
      <UiElement as="nav" names={["aria-label"]} namespaces={["product-guide","get-started"]} attributes={{ "aria-label": setupCopy.navigation.label, "className": "mt-3 flex shrink-0 flex-col sm:mt-0" }}>
        <Link href="/get-started" className={linkClass}><UiText source={setupCopy.navigation.start} namespaces={["product-guide","get-started"]} /></Link>
        <Link href="/download" className={linkClass}><UiText source={setupCopy.navigation.downloadAction} namespaces={["product-guide","get-started"]} /></Link>
        <Link href="/integrations" className={linkClass}><UiText source={setupCopy.navigation.connectAction} namespaces={["product-guide","get-started"]} /></Link>
      </UiElement>
    </div>
  </section>;
}

export function ProductProof() {
  return <section className="mx-auto max-w-[1180px] px-4 pt-12 sm:px-[30px]" aria-labelledby="product-proof">
    <div className="border-l-2 border-paid bg-paper p-6 sm:p-8">
      <p className="font-mono text-xs uppercase tracking-widest text-seal"><UiText source={copy("product.proofKicker")} namespaces={["product-guide","get-started"]} /></p>
      <h2 id="product-proof" className="mt-3 font-display text-3xl"><UiText source={copy("product.proofTitle")} namespaces={["product-guide","get-started"]} /></h2>
      <p className="mt-4 max-w-[76ch] font-serif leading-relaxed text-ink-2"><UiText source={copy("product.proofBody")} namespaces={["product-guide","get-started"]} /></p>
      <UiElement as="nav" names={["aria-label"]} namespaces={["product-guide","get-started"]} attributes={{ "className": "mt-4 flex flex-wrap gap-x-6", "aria-label": copy("product.proofKicker") }}>
        <Link href="/walkthrough" prefetch={false} className={linkClass}><UiText source={copy("product.walkthrough")} namespaces={["product-guide","get-started"]} /></Link>
        <Link href="/proof" className={linkClass}><UiText source={copy("product.proof")} namespaces={["product-guide","get-started"]} /></Link>
        <Link href="/quality" className={linkClass}><UiText source={copy("product.quality")} namespaces={["product-guide","get-started"]} /></Link>
      </UiElement>
    </div>
  </section>;
}

export function ProductFaq() {
  const questions = [
    [copy("product.faqWallet"), copy("product.faqWalletBody")],
    [copy("product.faqPublic"), copy("product.faqPublicBody")],
    [copy("product.faqPayment"), copy("product.faqPaymentBody")],
    [copy("product.faqTrust"), copy("product.faqTrustBody")],
  ];
  return <section className="mx-auto max-w-[1180px] px-4 py-12 sm:px-[30px]" aria-labelledby="product-faq">
    <h2 id="product-faq" className="font-display text-3xl"><UiText source={copy("product.faqTitle")} namespaces={["product-guide","get-started"]} /></h2>
    <div className="mt-5 border-y border-line">
      {questions.map(([question, answer]) => <details key={question} className="border-b border-line last:border-b-0">
        <summary className="min-h-11 cursor-pointer py-4 font-serif text-lg text-ink"><UiText source={question} namespaces={["product-guide"]} /></summary>
        <p className="max-w-[76ch] pb-5 font-serif leading-relaxed text-ink-2"><UiText source={answer} namespaces={["product-guide"]} /></p>
      </details>)}
    </div>
    <UiElement as="nav" names={["aria-label"]} namespaces={["product-guide","get-started"]} attributes={{ "className": "mt-5 flex flex-wrap gap-x-6", "aria-label": copy("product.faqTitle") }}>
      <Link href="/#dispatch" className={linkClass}><UiText source={copy("product.try")} namespaces={["product-guide","get-started"]} /></Link>
      <Link href="/pricing" className={linkClass}><UiText source={copy("product.pricing")} namespaces={["product-guide","get-started"]} /></Link>
      <Link href="/about" className={linkClass}><UiText source={copy("product.about")} namespaces={["product-guide","get-started"]} /></Link>
    </UiElement>
  </section>;
}

/** Public entry context only; this never changes a report's evidence or payment state. */
export function ProductEntryNote() {
  return <UiElement as="aside" names={["aria-label"]} namespaces={["product-guide","get-started"]} attributes={{ "className": "mb-8 max-w-[860px] border border-line bg-paper p-5", "aria-label": copy("product.entryLabel") }}>
    <p className="font-serif text-sm leading-relaxed text-ink-2"><UiText source={copy("product.entryBody")} namespaces={["product-guide","get-started"]} /></p>
    <div className="mt-2 flex flex-wrap gap-x-5">
      <Link href="/#dispatch" className={linkClass}><UiText source={copy("product.try")} namespaces={["product-guide","get-started"]} /></Link>
      <Link href="/pricing" className={linkClass}><UiText source={copy("product.pricing")} namespaces={["product-guide","get-started"]} /></Link>
      <Link href="/about" className={linkClass}><UiText source={copy("product.about")} namespaces={["product-guide","get-started"]} /></Link>
    </div>
  </UiElement>;
}
