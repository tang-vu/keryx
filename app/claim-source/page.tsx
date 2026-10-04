import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { PublicSourceClaimForm } from "@/components/keryx/public-source-claim-form";
import { sourceClaimDraft } from "@/lib/registration-return";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Claim your public source", description: "Prove control of your website, then separately choose free reads, citation rewards or paid access." };

export default async function ClaimSourcePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["url", "referenceId", "claimId", "challengeId", "owner"]) if (typeof query[key] === "string") params.set(key, query[key]);
  let initial = {}, initialError = "";
  try {
    const draft = sourceClaimDraft(params);
    initial = draft;
    if (draft.referenceId) {
      const db = await getDb();
      const reference = await db.getPublicReference?.(draft.referenceId);
      if (!reference) throw new Error("This public reference is unavailable. Enter the source's HTTPS URL below.");
      initial = { ...draft, url: reference.url, rssUrl: reference.rssUrl, name: reference.name };
    }
  } catch (error) { initialError = error instanceof Error ? error.message : "This source context could not be loaded."; }
  return <div className="min-h-screen bg-paper">
    <SiteHeader />
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">For publishers</p>
      <h1 className="mt-3 font-display text-[clamp(34px,6vw,58px)] leading-tight text-ink">This is <em className="text-paid">my source.</em></h1>
      <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-ink-2">Prove control of a public HTTPS website, RSS feed or PDF. Then choose whether your registered listing stays free, receives citation rewards, or charges per read.</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">Public web discovery already reads supported sources for free when available. Verification alone earns nothing. Existing public references, cached free reads and historical receipts keep their original free status.</p>
      <PublicSourceClaimForm initial={initial} initialError={initialError} />
    </main>
    <SiteFooter />
  </div>;
}
