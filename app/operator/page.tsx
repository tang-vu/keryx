import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import Link from "next/link";
import { createMessages } from "@/lib/i18n/messages";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { OperatorBusinessView } from "@/components/keryx/operator-business-view";
import { evidenceProcurementCopy } from "@/lib/evidence-procurement/copy";
import { decisionLabCopy } from "@/lib/research-audit/decision-lab-copy";

const message = createMessages("en");

export const metadata: Metadata = {
  alternates: englishPublicAlternates("/operator"),
  title: message("operatorPage.metadataTitle"),
  description: message("operatorPage.metadataDescription"),
};

export default function OperatorPage() {
  return (
    <div className="min-h-screen bg-paper-2 text-ink">
      <SiteHeader />
      <main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-[30px] sm:py-16">
        <Link href="/operator/ledger" className="mb-6 inline-block text-sm underline">{createMessages("en")("jobLedger.title")}</Link>
        <Link prefetch={false} href="/operator/evidence" className="mb-6 ml-5 inline-block text-sm underline">{evidenceProcurementCopy.links.commission}</Link>
        <Link href="/operator/decisions" className="mb-6 ml-5 inline-block text-sm underline">{decisionLabCopy.operatorLink}</Link>
        <OperatorBusinessView />
      </main>
      <SiteFooter />
    </div>
  );
}
