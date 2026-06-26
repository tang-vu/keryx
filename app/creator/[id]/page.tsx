import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { CreatorDetailView } from "./creator-detail-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const db = await getDb();
    const source = await db.getSource(id);
    if (!source) return { title: "Creator not found — Keryx" };
    return {
      title: `${source.name} — Keryx Creator`,
      description: `${source.name} earns USDC every time an AI agent cites their work on Keryx.`,
    };
  } catch {
    return { title: "Keryx Creator" };
  }
}

export default async function CreatorPage({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) notFound();

  return (
    <div className="min-h-screen bg-paper-2">
      <header className="border-b border-ink bg-paper">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-4 py-3 sm:px-[30px]">
          <Link
            href="/"
            className="font-display text-[15px] font-semibold tracking-tight text-ink"
          >
            KERYX
          </Link>
          <Link
            href="/dashboard"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:text-ink"
          >
            ← Back to ledger
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 pb-20 pt-10 sm:px-[30px]">
        <CreatorDetailView creatorId={id} />
      </main>
    </div>
  );
}
