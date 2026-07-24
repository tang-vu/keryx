/**
 * /me/asks — the asker's side of the ledger: every dispatch this wallet ran, what it cost, and
 * which creators the money reached. The mirror of /me/sources, for the wallet that pays instead
 * of the wallet that earns.
 */

import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { MyAsksView } from "./my-asks-view";

export const metadata: Metadata = {
  title: "My dispatches — Keryx",
  description: "Every question this wallet dispatched, what it spent, and which creators it paid.",
  robots: { index: false }, // wallet-personal surface — nothing here for a crawler
};

export default function MyAsksPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
        <div className="mb-8 border-b border-line pb-6">
          <h1 className="font-serif text-2xl text-ink">My dispatches</h1>
          <p className="mt-1 font-mono text-xs text-ink-3">
            Questions you dispatched while signed in with this wallet — the toll each one paid, and
            the creators it reached. Every row opens its full reasoning trace.
          </p>
        </div>
        <MyAsksView />
      </main>
    </>
  );
}
