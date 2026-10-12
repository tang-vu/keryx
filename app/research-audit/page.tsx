import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { ResearchEvidenceAuditWorkspace } from "@/components/keryx/research-evidence-audit";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";

export const metadata: Metadata = {
  title: "Research evidence audit",
  description: "Check reviewed claim costs and compare captured decisions with a portable receipt using local data.",
  alternates: englishPublicAlternates("/research-audit"),
};

export default function ResearchEvidenceAuditPage() {
  return <div className="min-h-screen bg-paper-2 text-ink">
    <SiteHeader />
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8 sm:py-16">
      <Link href="/operator/decisions" className="text-sm underline">Decision Lab</Link>
      <h1 className="mt-6 font-display text-4xl sm:text-5xl">Research evidence audit</h1>
      <p className="mt-3 max-w-3xl font-serif text-lg text-ink-2">Measure the cost of claims you have reviewed, then compare the recorded buying terms with the receipt. Missing costs and ambiguous payment links stay visible.</p>
      <ResearchEvidenceAuditWorkspace />
    </main>
    <SiteFooter />
  </div>;
}
