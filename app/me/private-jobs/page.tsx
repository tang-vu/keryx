import type { Metadata } from "next";
import { ownedHistoryCopy } from "@/locales/en/owned-history";
import { SiteHeader } from "@/components/keryx/site-header";
import { PrivateJobHistoryWorkspace } from "@/components/keryx/private-job-history-workspace";
import { UiText } from "@/lib/i18n/ui-copy";



export const metadata: Metadata = {
  title: ownedHistoryCopy.privateJobs.page.metadataTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// This shell receives no session, wallet, questions or results from the server.
export default function PrivateJobsPage() {
  return <><SiteHeader /><main className="mx-auto max-w-[980px] px-4 py-10 sm:px-8">
    <h1 className="font-serif text-2xl text-ink"><UiText source={ownedHistoryCopy.privateJobs.page.title} namespaces={["owned-history"]} /></h1>
    <p className="mt-2 mb-6 text-sm text-ink-3"><UiText source={ownedHistoryCopy.privateJobs.page.introduction} namespaces={["owned-history"]} /></p>
    <PrivateJobHistoryWorkspace />
  </main></>;
}
