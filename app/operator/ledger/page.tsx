import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { OperatorLedgerView } from "@/components/keryx/operator-ledger-view";
import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");
export const metadata: Metadata = { title: message("jobLedger.title"), description: message("jobLedger.description") };

export default function PublicJobLedgerPage() {
  return <div className="min-h-screen bg-paper-2 text-ink">
    <SiteHeader />
    <main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-[30px] sm:py-16"><OperatorLedgerView /></main>
    <SiteFooter />
  </div>;
}
