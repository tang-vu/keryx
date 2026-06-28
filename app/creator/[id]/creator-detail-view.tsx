"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Banknote, Calendar, Hash, Wallet } from "lucide-react";
import { fmtUsdc, shortAddr } from "@/components/keryx/phase-style";
import { cn } from "@/lib/utils";

interface CreatorData {
  source: {
    id: string;
    name: string;
    description: string;
    walletAddress: string;
    fetchPrice: number;
    verified: boolean;
  };
  stats: {
    totalEarned: number;
    settledTotal: number;
    paymentCount: number;
    citationCount: number;
    rank: number;
  };
  recentPayments: {
    id: string;
    queryId: string;
    kind: string;
    amountUsdc: number;
    settled: boolean;
    txHash: string | null;
    createdAt: string;
    /** The question that triggered this payout — what work of theirs was used. */
    question: string | null;
  }[];
  dailyEarnings: { date: string; amount: number }[];
}

export function CreatorDetailView({ creatorId }: { creatorId: string }) {
  const [data, setData] = useState<CreatorData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/creator/${creatorId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject("Failed to load")))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [creatorId]);

  if (error) {
    return <p className="py-20 text-center font-mono text-sm text-destructive">{error}</p>;
  }
  if (!data) {
    return <CreatorSkeleton />;
  }

  const { source, stats, recentPayments, dailyEarnings } = data;
  const maxDaily = Math.max(...dailyEarnings.map((d) => d.amount), 0.001);

  return (
    <>
      {/* Header */}
      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-seal bg-seal/10 font-display text-xl font-bold text-seal">
          #{stats.rank || "–"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[clamp(22px,3vw,30px)] font-medium tracking-tight text-ink">
              {source.name}
            </h1>
            {source.verified && (
              <BadgeCheck className="h-5 w-5 text-seal" />
            )}
          </div>
          <p className="mt-1 max-w-xl font-serif text-[14px] text-ink-2">
            {source.description || "Registered creator on Keryx."}
          </p>
          <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-ink-3">
            <span className="flex items-center gap-1">
              <Wallet className="h-3 w-3" />
              {shortAddr(source.walletAddress)}
            </span>
            <span className="flex items-center gap-1">
              <Banknote className="h-3 w-3" />
              ${fmtUsdc(source.fetchPrice)}/read
            </span>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={Banknote}
          label="Total earned"
          value={`$${fmtUsdc(stats.totalEarned)}`}
          sub={`$${fmtUsdc(stats.settledTotal)} settled`}
          accent="paid"
        />
        <StatTile
          icon={Hash}
          label="Citations"
          value={String(stats.citationCount)}
          sub={`${stats.paymentCount} payments`}
        />
        <StatTile
          icon={Calendar}
          label="Active days"
          value={String(dailyEarnings.length)}
          sub="last 14 days"
        />
        <StatTile
          icon={BadgeCheck}
          label="Rank"
          value={`#${stats.rank || "–"}`}
          sub="creator leaderboard"
          accent="seal"
        />
      </section>

      {/* Earnings chart */}
      {dailyEarnings.length > 0 && (
        <section className="mb-8 border border-line bg-paper p-5">
          <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            Earnings · last 14 days
          </h2>
          <div className="flex items-end gap-1" style={{ height: 100 }}>
            {dailyEarnings.map((d) => (
              <div
                key={d.date}
                className="flex-1 rounded-t-sm bg-seal transition-all hover:bg-seal/80"
                style={{ height: `${Math.max(2, (d.amount / maxDaily) * 100)}%` }}
                title={`${d.date}: $${fmtUsdc(d.amount)}`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-ink-3">
            <span>{dailyEarnings[0]?.date}</span>
            <span>{dailyEarnings[dailyEarnings.length - 1]?.date}</span>
          </div>
        </section>
      )}

      {/* Recent payments */}
      <section className="border border-line bg-paper p-5">
        <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          Recent payments ({recentPayments.length})
        </h2>
        {recentPayments.length === 0 ? (
          <p className="py-6 text-center font-serif text-sm text-ink-3">
            No payments yet.
          </p>
        ) : (
          <div className="space-y-2">
            {recentPayments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/dispatch/${p.queryId}`}
                    className="block truncate font-serif text-[13px] leading-snug text-ink transition-colors hover:text-seal"
                    title={p.question ?? p.queryId}
                  >
                    {p.question ?? `Dispatch ${p.queryId.slice(0, 8)}…`}
                  </Link>
                  <p className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink-3">
                    <span
                      className={cn(
                        "rounded px-1 py-px uppercase tracking-wide",
                        p.kind === "citation" ? "bg-paid/10 text-paid" : "bg-paper-2 text-ink-3",
                      )}
                    >
                      {p.kind === "citation" ? "cited" : "read"}
                    </span>
                    {new Date(p.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="font-mono text-sm font-semibold text-paid">
                    ${fmtUsdc(p.amountUsdc)}
                  </span>
                  {p.settled && p.txHash && (
                    <p className="font-mono text-[10px] text-ink-3">
                      tx {p.txHash.slice(0, 10)}…
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="border border-line bg-paper p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-ink-3" />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "font-display text-xl font-semibold tabular-nums",
          accent === "paid" ? "text-paid" : accent === "seal" ? "text-seal" : "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 font-mono text-[10px] text-ink-3">{sub}</p>}
    </div>
  );
}

/** Shimmer placeholder shown while the creator profile loads — mirrors the real
 *  layout (identity, four stat tiles, a chart block) so the page doesn't jump. */
function CreatorSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 flex items-start gap-4">
        <div className="h-14 w-14 shrink-0 rounded-full bg-ink/10" />
        <div className="flex-1 space-y-2">
          <div className="h-7 w-56 rounded bg-ink/10" />
          <div className="h-4 w-full max-w-md rounded bg-ink/10" />
          <div className="h-3 w-40 rounded bg-ink/10" />
        </div>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded border border-line bg-paper" />
        ))}
      </div>
      <div className="h-[180px] rounded border border-line bg-paper" />
    </div>
  );
}
