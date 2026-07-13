import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { cleanText } from "@/lib/answers-archive";
import { DispatchView } from "./dispatch-view";

const BASE = process.env.BASE_URL || "https://keryx.cc";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const db = await getDb();
    const run = await db.getQueryRun(id);
    if (!run) return { title: "Dispatch not found — Keryx" };
    const snippet = run.answer.slice(0, 160).replace(/\n/g, " ");
    const cited = run.citations.length;
    return {
      title: `${run.question} — Keryx Dispatch`,
      description: `${cited} source${cited !== 1 ? "s" : ""} cited · $${run.totalSpent.toFixed(4)} spent · ${snippet}…`,
      alternates: { canonical: `/dispatch/${id}` },
      openGraph: {
        title: `${run.question} — Keryx Dispatch`,
        description: `${cited} cited · $${run.totalSpent.toFixed(4)} spent · $${run.totalToCreators.toFixed(4)} to creators`,
      },
    };
  } catch {
    return { title: "Keryx Dispatch" };
  }
}

export default async function DispatchPage({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const run = await db.getQueryRun(id);
  if (!run) notFound();
  // Load the real citation payouts so the permalink reflects on-chain settlement
  // truth (settled / batched) instead of reconstructing a "simulated" view.
  const payments = await db.listPaymentsByQuery(id);

  // QAPage structured data — lets search + AI crawlers read this permalink as a
  // question with an accepted answer, and surface the sources it credited.
  const answerText = cleanText(run.answer);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "QAPage",
    mainEntity: {
      "@type": "Question",
      name: run.question,
      answerCount: answerText ? 1 : 0,
      ...(answerText
        ? {
            acceptedAnswer: {
              "@type": "Answer",
              text: answerText,
              url: `${BASE}/dispatch/${id}`,
              ...(run.citations.length
                ? { citation: run.citations.map((c) => c.sourceName).filter(Boolean) }
                : {}),
            },
          }
        : {}),
    },
  };

  return (
    <div className="min-h-screen bg-paper-2">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Minimal header */}
      <header className="border-b border-ink bg-paper">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-4 py-3 sm:px-[30px]">
          <Link
            href="/"
            className="font-display text-[15px] font-semibold tracking-tight text-ink"
          >
            KERYX
          </Link>
          <div className="flex items-center gap-5">
            <Link
              href="/answers"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:text-ink"
            >
              The archive
            </Link>
            <Link
              href="/"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:text-ink"
            >
              ← New dispatch
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 pb-20 pt-10 sm:px-[30px]">
        <DispatchView run={run} payments={payments} />
      </main>
    </div>
  );
}
