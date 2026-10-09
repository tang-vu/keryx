import type { Metadata } from "next";
import Link from "next/link";
import { createMessages } from "@/lib/i18n/messages";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { OperatorBusinessView } from "@/components/keryx/operator-business-view";

export const metadata: Metadata = {
  title: "Operator — Keryx",
  description: "Follow Keryx's prepaid research operations, recorded decisions, delivery queue and review needs.",
};

export default function OperatorPage() {
  return (
    <div className="min-h-screen bg-paper-2 text-ink">
      <SiteHeader />
      <main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-[30px] sm:py-16">
        <Link href="/operator/ledger" className="mb-6 inline-block text-sm underline">{createMessages("en")("jobLedger.title")}</Link>
        <OperatorBusinessView />
      </main>
      <SiteFooter />
    </div>
  );
}
