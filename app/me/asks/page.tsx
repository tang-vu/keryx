/**
 * /me/asks — the asker's side of the ledger: every dispatch this wallet ran, what it cost, and
 * which creators the money reached. The mirror of /me/sources, for the wallet that pays instead
 * of the wallet that earns.
 */

import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { MyAsksView } from "./my-asks-view";
import { OwnerRunAssignmentInbox } from "@/components/keryx/owner-run-assignment-inbox";
import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

export const metadata: Metadata = {
  title: message("myHistory.metadataTitle"),
  description: message("myHistory.metadataDescription"),
  robots: { index: false }, // wallet-personal surface — nothing here for a crawler
};

export default function MyAsksPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[820px] px-4 py-10 sm:px-8">
        <div className="mb-8 border-b border-line pb-6">
          <h1 className="font-serif text-2xl text-ink">{message("myHistory.title")}</h1>
          <p className="mt-1 font-mono text-xs text-ink-3">
            {message("myHistory.introduction")}
          </p>
        </div>
        <MyAsksView />
        <div className="mt-10 border-t border-line pt-8"><OwnerRunAssignmentInbox readOnlyView /></div>
      </main>
    </>
  );
}
