import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { PublicSourceClaimForm } from "@/components/keryx/public-source-claim-form";
import { sourceClaimDraft } from "@/lib/registration-return";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: uiCopy("sourceClaimPage.title"), description: uiCopy("sourceClaimPage.description") };

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
      if (!reference) throw new Error(uiCopy("sourceClaimPage.referenceUnavailable"));
      initial = { ...draft, url: reference.url, rssUrl: reference.rssUrl, name: reference.name };
    }
  } catch (error) { initialError = error instanceof Error ? error.message : uiCopy("sourceClaimPage.loadFailed"); }
  return <div className="min-h-screen bg-paper">
    <SiteHeader />
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">{uiCopy("sourceClaimPage.publisher")}</p>
      <h1 className="mt-3 font-display text-[clamp(34px,6vw,58px)] leading-tight text-ink">{uiRichCopy("sourceClaimPage.heading", { source: <em className="text-paid">{uiCopy("sourceClaimPage.mySource")}</em> })}</h1>
      <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-ink-2">{uiCopy("sourceClaimPage.introduction")}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">{uiCopy("sourceClaimPage.freeHistory")}</p>
      <PublicSourceClaimForm initial={initial} initialError={initialError} />
    </main>
    <SiteFooter />
  </div>;
}
