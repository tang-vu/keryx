
import { getDb } from "@/lib/db";
import type { Metadata } from "next";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { loadSourceDirectory, unavailableSourceDirectory } from "@/lib/sources/source-directory";
import { DashboardView } from "@/components/keryx/dashboard-view";
import { SourceDirectoryPreview } from "@/components/keryx/source-directory-preview";
import { Suspense } from "react";
import { HistoricalHistorySection } from "@/components/keryx/testnet-history-summary";
import { UiMessage } from "@/lib/i18n/ui-copy";





export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: englishPublicAlternates("/dashboard") };

async function SourceDirectorySection() {
  const directory = await getDb().then(loadSourceDirectory).catch(unavailableSourceDirectory);
  return <SourceDirectoryPreview directory={directory} />;
}

export default function DashboardPage() {
  return <DashboardView historyPreview={<Suspense fallback={<p role="status" className="mt-8 text-sm"><UiMessage messageKey={"ledgerPage.loadingHistory"} /></p>}><HistoricalHistorySection /></Suspense>} sourcePreview={<Suspense fallback={<p role="status" className="mt-10 text-sm text-ink-2"><UiMessage messageKey={"ledgerPage.loadingSources"} /></p>}><SourceDirectorySection /></Suspense>} />;
}
