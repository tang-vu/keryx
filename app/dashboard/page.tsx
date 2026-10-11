import { createMessages } from "@/lib/i18n/messages";
import { getDb } from "@/lib/db";
import { loadSourceDirectory, unavailableSourceDirectory } from "@/lib/sources/source-directory";
import { DashboardView } from "@/components/keryx/dashboard-view";
import { SourceDirectoryPreview } from "@/components/keryx/source-directory-preview";
import { Suspense } from "react";
import { HistoricalHistorySection } from "@/components/keryx/testnet-history-summary";

const uiCopy = createMessages("en");

export const dynamic = "force-dynamic";

async function SourceDirectorySection() {
  const directory = await getDb().then(loadSourceDirectory).catch(unavailableSourceDirectory);
  return <SourceDirectoryPreview directory={directory} />;
}

export default function DashboardPage() {
  return <DashboardView historyPreview={<Suspense fallback={<p role="status" className="mt-8 text-sm">{uiCopy("ledgerPage.loadingHistory")}</p>}><HistoricalHistorySection /></Suspense>} sourcePreview={<Suspense fallback={<p role="status" className="mt-10 text-sm text-ink-2">{uiCopy("ledgerPage.loadingSources")}</p>}><SourceDirectorySection /></Suspense>} />;
}
