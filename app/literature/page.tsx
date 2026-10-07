import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { LiteratureWorkspace } from "@/components/keryx/literature-workspace";

export const metadata: Metadata = {
  title: "Literature workspace — save, screen and compare research papers",
  description: "Keep a personal paper shortlist, screening notes and a review question. Export your screening list or prepare a cited comparison from two saved papers.",
  alternates: { canonical: "/literature" },
};

export default function LiteraturePage() {
  return <div className="min-h-screen bg-paper-2">
    <SiteHeader />
    <main className="mx-auto max-w-[1040px] px-4 pb-20 pt-12 sm:px-[30px]">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">Your literature review</p>
      <h1 className="mt-3 font-display text-[clamp(30px,5vw,46px)] font-medium leading-tight text-ink">From a paper list to a focused review.</h1>
      <p className="mt-4 max-w-[65ch] font-serif text-lg leading-relaxed text-ink-2">Save the papers worth checking, record your screening decisions, and return to the question you are trying to answer.</p>
      <nav aria-label="Literature workflow" className="mt-5 flex flex-wrap gap-3">
        <Link prefetch={false} href="/sources?kind=paper#research-papers" className="inline-flex min-h-11 items-center border border-ink bg-seal px-4 py-2 font-mono text-xs text-paper">Find papers to save →</Link>
        <a href="#literature-project" className="inline-flex min-h-11 items-center px-2 py-2 font-mono text-xs text-seal underline">Set your review focus</a>
      </nav>
      <LiteratureWorkspace />
      <noscript><p className="mt-5 font-serif text-sm text-ink-2">Enable JavaScript to access papers saved in this browser. The public paper library remains available through Sources.</p></noscript>
    </main>
    <SiteFooter />
  </div>;
}
