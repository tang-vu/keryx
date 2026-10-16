import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { WalletWorkspace } from "@/components/keryx/wallet-workspace";
import { walletWorkspaceMessages as copy } from "@/locales/en/wallet-workspace";
import { UiText } from "@/lib/i18n/ui-copy";



export const metadata: Metadata = {
  title: copy.title,
  description: copy.description,
  robots: { index: false, follow: false },
};

export default function WalletPage() {
  return <div className="min-h-screen bg-paper text-ink">
    <SiteHeader />
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-8 sm:py-12">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div className="min-w-0 space-y-2">
          <h1 className="font-display text-4xl sm:text-5xl"><UiText source={copy.title} namespaces={["wallet-workspace"]} /></h1>
          <p className="max-w-[54ch] text-sm leading-relaxed text-ink-2"><UiText source={copy.description} namespaces={["wallet-workspace"]} /></p>
        </div>
        <Link href="/" className="inline-flex min-h-11 items-center border border-ink bg-ink px-4 text-sm text-cream"><UiText source={copy.backToChat} namespaces={["wallet-workspace"]} /></Link>
      </header>
      <WalletWorkspace />
    </main>
    <SiteFooter />
  </div>;
}
