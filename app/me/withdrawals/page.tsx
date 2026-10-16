import { createMessages } from "@/lib/i18n/messages";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { WithdrawalAccount } from "@/components/keryx/withdrawal-account";
import { withdrawalWorkspaceLimits } from "@/lib/gateway/withdrawal-workspace-limits";
import { config } from "@/lib/config";
import { UiMessage } from "@/lib/i18n/ui-copy";



const uiCopy = createMessages("en");

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: uiCopy("withdrawalPage.metadataTitle"),
  description: uiCopy("withdrawalPage.description"), robots: { index: false } };

export default function WithdrawalsPage() {
  const limits = withdrawalWorkspaceLimits(process.env, config);
  return <div className="min-h-screen bg-paper-2 text-ink">
    <SiteHeader />
    <main className="mx-auto max-w-[820px] space-y-8 px-4 py-10 sm:px-8">
      <header className="space-y-3 border-b border-line pb-6">
        <h1 className="font-display text-4xl"><UiMessage messageKey={"withdrawalPage.title"} /></h1>
        <p className="font-serif text-ink-2"><UiMessage messageKey={"withdrawalPage.introduction"} /></p>
        <p className="text-sm text-ink-3"><UiMessage messageKey={"withdrawalPage.historyBoundary"} values={{ network: config.profile.label }} /></p>
        <Link href="/me/sources" className="inline-block text-sm underline"><UiMessage messageKey={"withdrawalPage.back"} /></Link>
      </header>
      <WithdrawalAccount limits={limits} />
    </main>
    <SiteFooter />
  </div>;
}
