import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { DraftCheckWorkspace } from "@/components/keryx/draft-check-workspace";
import { draftCheckCopy as copy } from "@/lib/research/draft-check-copy";

export const metadata: Metadata = {
  title: copy.page.metadataTitle,
  description: copy.page.metadataDescription,
  alternates: { canonical: "/literature/check" }, robots: { index: false, follow: false },
};
export default function DraftCheckPage() {
  return <div className="min-h-screen bg-paper-2"><SiteHeader />
    <main className="mx-auto max-w-[1040px] px-4 pb-20 pt-12 sm:px-[30px]">
      <Link prefetch={false} href="/literature" className="font-mono text-xs text-seal underline">{copy.page.back}</Link>
      <h1 className="mt-4 font-display text-[clamp(28px,5vw,42px)] leading-tight text-ink">{copy.page.heading}</h1>
      <p className="mt-4 font-serif text-lg text-ink-2">{copy.page.introduction}</p>
      <DraftCheckWorkspace />
      <noscript><p className="mt-5 font-serif text-sm">{copy.page.noScript}</p></noscript>
    </main><SiteFooter /></div>;
}
