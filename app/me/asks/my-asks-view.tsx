"use client";

/**
 * The wallet's dispatch ledger: a summary strip (own spend vs free-trial dispatches, kept apart on
 * purpose) over a list of every attributed dispatch, each showing the creators its toll reached.
 * Read-only — the dispatch permalink stays the place to re-read an answer and its trace.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { fmtUsdc } from "@/components/keryx/phase-style";

interface AskCreator {
  sourceId: string;
  name: string;
  rewardUsdc: number;
}

interface AskRow {
  id: string;
  question: string;
  createdAt: string;
  spentUsdc: number;
  toCreatorsUsdc: number;
  citationCount: number;
  creators: AskCreator[];
  confidence: "High" | "Moderate" | "Low" | null;
  funded: boolean;
  isFollowUp: boolean;
  /** A cited source has published since this dispatch settled — a re-ask would read new material. */
  hasNewMaterial: boolean;
}

interface Totals {
  dispatches: number;
  spentUsdc: number;
  toCreatorsUsdc: number;
  citations: number;
  trialDispatches: number;
  trialToCreatorsUsdc: number;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function MyAsksView() {
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [asks, setAsks] = useState<AskRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/me/asks", { cache: "no-store" });
        if (res.status === 401) {
          setSignedOut(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as {
          asks: AskRow[];
          totals: Totals;
          truncated: boolean;
        };
        setAsks(d.asks);
        setTotals(d.totals);
        setTruncated(d.truncated);
      } catch {
        toast.error("Couldn't load your dispatches — try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="font-mono text-xs text-ink-3">Loading your dispatches…</p>;

  if (signedOut)
    return (
      <div className="rounded border border-dashed border-line p-8 text-center">
        <p className="mb-2 font-serif text-sm text-ink-2">
          Sign in with the wallet you ask from to see its dispatches.
        </p>
        <Link href="/connect" className="font-mono text-xs text-seal underline underline-offset-2">
          Connect wallet →
        </Link>
      </div>
    );

  if (asks.length === 0)
    return (
      <div className="rounded border border-dashed border-line p-8 text-center">
        <p className="mb-2 font-serif text-sm text-ink-2">
          No dispatches from this wallet yet. Dispatches you ran signed out aren&apos;t attributed
          to anyone — sign in first and the next one lands here.
        </p>
        <Link href="/" className="font-mono text-xs text-seal underline underline-offset-2">
          Ask a question →
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {/* Summary strip */}
      {totals && (
        <section className="border border-line bg-paper p-5">
          <h2 className="mb-4 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            <Receipt className="h-3.5 w-3.5 text-seal" /> Your tolls
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="font-serif text-xl text-ink">{totals.dispatches}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                dispatches
              </p>
            </div>
            <div>
              <p className="font-serif text-xl text-ink">${fmtUsdc(totals.spentUsdc)}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                spent from your wallet
              </p>
            </div>
            <div>
              <p className="font-serif text-xl text-seal">${fmtUsdc(totals.toCreatorsUsdc)}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                of it to creators
              </p>
            </div>
            <div>
              <p className="font-serif text-xl text-ink">{totals.citations}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                citations paid
              </p>
            </div>
          </div>
          {totals.trialDispatches > 0 && (
            <p className="mt-4 border-t border-line pt-3 font-mono text-[10px] text-ink-3">
              {totals.trialDispatches} of these ran on the free trial — Keryx&apos;s treasury paid
              ${fmtUsdc(totals.trialToCreatorsUsdc)} to creators for them, not your wallet.
            </p>
          )}
        </section>
      )}

      {/* Dispatch rows */}
      <section className="divide-y divide-line border border-line bg-paper">
        {asks.map((a) => (
          <div key={a.id} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link
                href={`/dispatch/${a.id}`}
                className="min-w-0 flex-1 font-serif text-[15px] text-ink underline-offset-2 hover:underline"
              >
                {a.question}
              </Link>
              <span className="font-mono text-[11px] text-ink-2">
                ${fmtUsdc(a.spentUsdc)}
                {!a.funded && <span className="text-ink-3"> · free trial</span>}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-ink-3">
              <span>{timeAgo(a.createdAt)}</span>
              <span>{a.citationCount} cited</span>
              {a.confidence && <span>{a.confidence.toLowerCase()} confidence</span>}
              {a.isFollowUp && <span>follow-up</span>}
              {a.hasNewMaterial && (
                <Link
                  href={`/?q=${encodeURIComponent(a.question)}&parent=${a.id}&run=1`}
                  title="A source this dispatch cited has published since — re-asking buys the new material"
                  className="border border-seal px-1.5 py-0.5 uppercase tracking-[0.1em] text-seal transition-colors hover:bg-seal hover:text-cream"
                >
                  new material · re-ask
                </Link>
              )}
            </div>
            {a.creators.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                {a.creators.map((c) => (
                  <Link
                    key={c.sourceId}
                    href={`/creator/${c.sourceId}`}
                    title={`Paid $${fmtUsdc(c.rewardUsdc)} for this citation`}
                    className="border border-line px-2 py-0.5 font-mono text-[10px] text-ink-2 transition-colors hover:border-seal hover:text-seal"
                  >
                    {c.name} · ${fmtUsdc(c.rewardUsdc)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      {truncated && (
        <p className="font-mono text-[10px] text-ink-3">
          Showing your most recent {asks.length} dispatches.
        </p>
      )}
    </div>
  );
}
