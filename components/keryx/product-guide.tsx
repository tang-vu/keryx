import Link from "next/link";
import { productGuideCopy as copy } from "@/locales/en/product-guide";

const linkClass = "inline-flex min-h-11 items-center font-mono text-xs text-paid underline underline-offset-4";

export function ProductOverview() {
  const audiences = [
    { title: copy("product.researchersTitle"), body: copy("product.researchersBody"), action: copy("product.researchersAction"), href: "/literature" },
    { title: copy("product.buildersTitle"), body: copy("product.buildersBody"), action: copy("product.buildersAction"), href: "/sources" },
    { title: copy("product.agentsTitle"), body: copy("product.agentsBody"), action: copy("product.agentsAction"), href: "/dev" },
  ];
  return <section className="mx-auto max-w-[1180px] px-4 pt-10 sm:px-[30px]" aria-labelledby="product-overview">
    <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy("product.overviewKicker")}</p>
    <h2 id="product-overview" className="mt-3 max-w-[30ch] font-display text-3xl leading-tight sm:text-4xl">{copy("product.overviewTitle")}</h2>
    <p className="mt-4 max-w-[76ch] font-serif text-lg leading-relaxed text-ink-2">{copy("product.overviewBody")}</p>
    <div className="mt-6 grid gap-4 md:grid-cols-3">
      {audiences.map(audience => <article key={audience.href} className="flex flex-col border border-line bg-paper p-6">
        <h3 className="font-display text-2xl">{audience.title}</h3>
        <p className="mb-3 mt-3 flex-1 font-serif leading-relaxed text-ink-2">{audience.body}</p>
        <Link className={linkClass} href={audience.href}>{audience.action}</Link>
      </article>)}
    </div>
  </section>;
}

export function ProductProof() {
  return <section className="mx-auto max-w-[1180px] px-4 pt-12 sm:px-[30px]" aria-labelledby="product-proof">
    <div className="border-l-2 border-paid bg-paper p-6 sm:p-8">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy("product.proofKicker")}</p>
      <h2 id="product-proof" className="mt-3 font-display text-3xl">{copy("product.proofTitle")}</h2>
      <p className="mt-4 max-w-[76ch] font-serif leading-relaxed text-ink-2">{copy("product.proofBody")}</p>
      <nav className="mt-4 flex flex-wrap gap-x-6" aria-label={copy("product.proofKicker")}>
        <Link href="/walkthrough" className={linkClass}>{copy("product.walkthrough")}</Link>
        <Link href="/proof" className={linkClass}>{copy("product.proof")}</Link>
        <Link href="/quality" className={linkClass}>{copy("product.quality")}</Link>
      </nav>
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
    <h2 id="product-faq" className="font-display text-3xl">{copy("product.faqTitle")}</h2>
    <div className="mt-5 border-y border-line">
      {questions.map(([question, answer]) => <details key={question} className="border-b border-line last:border-b-0">
        <summary className="min-h-11 cursor-pointer py-4 font-serif text-lg text-ink">{question}</summary>
        <p className="max-w-[76ch] pb-5 font-serif leading-relaxed text-ink-2">{answer}</p>
      </details>)}
    </div>
    <nav className="mt-5 flex flex-wrap gap-x-6" aria-label={copy("product.faqTitle")}>
      <Link href="/#dispatch" className={linkClass}>{copy("product.try")}</Link>
      <Link href="/pricing" className={linkClass}>{copy("product.pricing")}</Link>
      <Link href="/about" className={linkClass}>{copy("product.about")}</Link>
    </nav>
  </section>;
}

/** Public entry context only; this never changes a report's evidence or payment state. */
export function ProductEntryNote() {
  return <aside className="mb-8 max-w-[860px] border border-line bg-paper p-5" aria-label={copy("product.entryLabel")}>
    <p className="font-serif text-sm leading-relaxed text-ink-2">{copy("product.entryBody")}</p>
    <div className="mt-2 flex flex-wrap gap-x-5">
      <Link href="/#dispatch" className={linkClass}>{copy("product.try")}</Link>
      <Link href="/pricing" className={linkClass}>{copy("product.pricing")}</Link>
      <Link href="/about" className={linkClass}>{copy("product.about")}</Link>
    </div>
  </aside>;
}
