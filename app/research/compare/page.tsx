import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ReportComparisonWorkspace } from "@/components/keryx/report-comparison-workspace";
import { UiText } from "@/lib/i18n/ui-copy";
import { reportComparisonCopy } from "@/locales/en/report-comparison";

export const metadata: Metadata = { title: { absolute: reportComparisonCopy.metadataTitle }, description: reportComparisonCopy.introduction,
  robots: { index: false, follow: true } };

export default function CompareResearchPage() {
  return <div className="min-h-screen bg-paper-2 text-ink">
    <SiteHeader />
    <main>
      <div className="mx-auto max-w-[1080px] px-4 pt-6 sm:px-8"><Link href="/research" className="font-mono text-xs text-ink-3 underline underline-offset-4">
        <UiText source={reportComparisonCopy.back} namespaces={["report-comparison"]} />
      </Link></div>
      <ReportComparisonWorkspace />
    </main>
    <SiteFooter />
  </div>;
}
