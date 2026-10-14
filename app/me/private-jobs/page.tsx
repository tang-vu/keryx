import type { Metadata } from "next";
import { SiteHeader } from "@/components/keryx/site-header";
import { PrivateJobHistoryWorkspace } from "@/components/keryx/private-job-history-workspace";

export const metadata: Metadata = {
  title: "Completed private jobs | Keryx",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// This shell receives no session, wallet, questions or results from the server.
export default function PrivateJobsPage() {
  return <><SiteHeader /><main className="mx-auto max-w-[980px] px-4 py-10 sm:px-8">
    <h1 className="font-serif text-2xl text-ink">Completed private jobs</h1>
    <p className="mt-2 mb-6 text-sm text-ink-3">Read saved private results for your signed-in payer wallet. This history covers the current store, with bounded scans and downloads.</p>
    <PrivateJobHistoryWorkspace />
  </main></>;
}
