import type { ReactNode } from "react";
import Link from "next/link";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
import { setupCopy } from "@/locales/en/get-started";
import { SUPPORT_MAILTO } from "@/lib/public-support";

export const setupLinkClass = "inline-flex min-h-11 items-center gap-2 text-sm text-paid underline underline-offset-4";

export function SetupGuide({ current, title, body, children }: { current: string; title: string; body: string; children: ReactNode }) {
  const navigation = [
    { href: "/get-started", label: setupCopy.navigation.start },
    { href: "/download", label: setupCopy.navigation.download },
    { href: "/integrations", label: setupCopy.navigation.integrations },
  ];
  return <div className="min-h-screen bg-paper-2">
    <SiteHeader />
    <main className="mx-auto max-w-[1180px] px-4 pb-12 pt-8 sm:px-[30px] sm:pt-12">
      <nav aria-label={setupCopy.navigation.label} className="flex flex-wrap gap-x-6 border-b border-line pb-3 font-mono">
        {navigation.map(link => <Link key={link.href} href={link.href} aria-current={current === link.href ? "page" : undefined} className={`${setupLinkClass} ${current === link.href ? "font-semibold text-ink" : ""}`}>{link.label}</Link>)}
      </nav>
      <header className="py-8 sm:py-12">
        <p className="font-mono text-xs uppercase tracking-widest text-seal">{setupCopy.navigation.label}</p>
        <h1 className="mt-3 max-w-[22ch] font-display text-[clamp(36px,6vw,64px)] leading-[1.06]">{title}</h1>
        <p className="mt-5 max-w-[70ch] font-serif text-lg leading-relaxed text-ink-2">{body}</p>
      </header>
      {children}
      <aside className="mt-12 border-t border-line pt-6">
        <h2 className="font-display text-2xl">{setupCopy.common.help}</h2>
        <p className="mt-3 max-w-[70ch] font-serif leading-relaxed text-ink-2">{setupCopy.common.helpBody}</p>
        <div className="mt-3 flex flex-wrap gap-x-6">
          <a href={SUPPORT_MAILTO} className={setupLinkClass}>{setupCopy.common.support}</a>
          <Link href="/pricing" className={setupLinkClass}>{setupCopy.common.pricing}</Link>
          <Link href="/status" className={setupLinkClass}>{setupCopy.common.status}</Link>
        </div>
      </aside>
    </main>
    <SiteFooter />
  </div>;
}

export function SetupSteps({ steps }: { steps: readonly string[] }) {
  return <ol className="mt-4 list-decimal space-y-3 pl-6 font-serif leading-relaxed text-ink-2">
    {steps.map(step => <li key={step} className="pl-1">{step}</li>)}
  </ol>;
}
