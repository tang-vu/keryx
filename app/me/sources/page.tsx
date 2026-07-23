/**
 * /me/sources — the creator's management desk: every source the signed-in wallet owns, with
 * notify state at a glance and portfolio-wide email alerts. The public creator pages stay the
 * per-source surface; this page exists so a bulk-imported portfolio is manageable in one place.
 */

import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { MySourcesView } from "./my-sources-view";

export const metadata: Metadata = {
  title: "My sources — Keryx",
  description: "Manage every source your wallet owns: citation email alerts, webhooks, earnings.",
  robots: { index: false }, // wallet-personal surface — nothing here for a crawler
};

export default function MySourcesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
        <div className="mb-8 border-b border-line pb-6">
          <h1 className="font-serif text-2xl text-ink">My sources</h1>
          <p className="mt-1 font-mono text-xs text-ink-3">
            Every source this wallet owns — payout or author. Set citation email alerts across the
            whole portfolio here; fine-grained settings (webhook, preview depth, badge, withdraw)
            live on each source&apos;s page.
          </p>
        </div>
        <MySourcesView />
      </main>
    </>
  );
}
