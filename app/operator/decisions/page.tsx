import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { DecisionLab } from "@/components/keryx/decision-lab";
import { decisionLabCopy as copy } from "@/lib/research-audit/decision-lab-copy";
import { englishPublicAlternates } from "@/lib/i18n/public-metadata";
import { evidenceAuditCopy } from "@/locales/en/evidence-audit";

export const metadata: Metadata = {
  title: copy.title,
  description: copy.description,
  alternates: englishPublicAlternates("/operator/decisions"),
};

export default function DecisionLabPage() {
  return <div className="min-h-screen bg-paper-2 text-ink">
    <SiteHeader />
    <main className="mx-auto max-w-[1180px] px-4 py-10 sm:px-[30px] sm:py-16">
      <Link href="/operator" className="text-sm underline">{copy.back}</Link>
      <h1 className="mt-6 font-display text-4xl sm:text-5xl">{copy.title}</h1>
      <p className="mt-3 max-w-3xl font-serif text-lg text-ink-2">{copy.description}</p>
      <DecisionLab />
      <Link href="/research-audit" className="mt-8 inline-block text-sm underline">{evidenceAuditCopy.decisionLabLink}</Link>
    </main>
    <SiteFooter />
  </div>;
}
