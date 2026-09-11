import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { WithdrawalAccount } from "@/components/keryx/withdrawal-account";
import { withdrawalWorkspaceLimits } from "@/lib/gateway/withdrawal-workspace-limits";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My withdrawals — Keryx",
  description: "Review and recover your Arc Testnet USDC withdrawal requests.", robots: { index: false } };

export default function WithdrawalsPage() {
  const limits = withdrawalWorkspaceLimits(process.env, config);
  return <div className="min-h-screen bg-paper-2 text-ink">
    <SiteHeader />
    <main className="mx-auto max-w-[820px] space-y-8 px-4 py-10 sm:px-8">
      <header className="space-y-3 border-b border-line pb-6">
        <h1 className="font-display text-4xl">My withdrawals</h1>
        <p className="font-serif text-ink-2">Review your USDC withdrawal and recover the same request after a disconnect.</p>
        <p className="text-sm text-ink-3">Arc Testnet only. Account history shows requests saved on the server, including from other browsers.
          Local drafts and private recovery files retain the original signing terms. Check pending requests before starting another withdrawal.</p>
        <Link href="/me/sources" className="inline-block text-sm underline">Back to my sources</Link>
      </header>
      <WithdrawalAccount limits={limits} />
    </main>
    <SiteFooter />
  </div>;
}
