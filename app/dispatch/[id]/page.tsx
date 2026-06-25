import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { DispatchView } from "./dispatch-view";

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

  return (
    <div className="min-h-screen bg-paper-2">
      {/* Minimal header */}
      <header className="border-b border-ink bg-paper">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-4 py-3 sm:px-[30px]">
          <Link
            href="/"
            className="font-display text-[15px] font-semibold tracking-tight text-ink"
          >
            KERYX
          </Link>
          <Link
            href="/"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:text-ink"
          >
            ← New dispatch
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 pb-20 pt-10 sm:px-[30px]">
        <DispatchView run={run} />
      </main>
    </div>
  );
}
