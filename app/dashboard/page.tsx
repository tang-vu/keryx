import { getDb } from "@/lib/db";
import { loadSourceDirectory, unavailableSourceDirectory } from "@/lib/sources/source-directory";
import { DashboardView } from "@/components/keryx/dashboard-view";
import { SourceDirectoryPreview } from "@/components/keryx/source-directory-preview";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

async function SourceDirectorySection() {
  const directory = await getDb().then(loadSourceDirectory).catch(unavailableSourceDirectory);
  return <SourceDirectoryPreview directory={directory} />;
}

export default function DashboardPage() {
  return <DashboardView sourcePreview={<Suspense fallback={<p role="status" className="mt-10 text-sm text-ink-2">Loading the source library…</p>}><SourceDirectorySection /></Suspense>} />;
}
