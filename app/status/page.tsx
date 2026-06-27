"use client";

/**
 * /status — a plain, honest uptime page. Polls /api/health and shows whether the
 * service is live, how long it's been up, the deployed commit, the settlement mode,
 * and headline traction. Read-only and safe to leave open — a tangible "this is a
 * real, running product" signal rather than a one-off hackathon demo.
 */

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";

interface Health {
  ok: boolean;
  db: string;
  commit: string | null;
  uptimeSeconds: number;
  reasoning: string;
  settles: string;
  network: string;
  time: string;
  traction?: {
    totalPayments: number;
    creatorPayoutsUsdc: number;
    creatorsEarning: number;
    totalQueries: number;
  };
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = (await r.json()) as Health;
        if (alive) {
          setHealth(j);
          setReachable(true);
        }
      } catch {
        if (alive) setReachable(false);
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const up = reachable && health?.ok;
  const label = up ? "All systems operational" : reachable ? "Degraded" : "Unreachable";

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 py-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          Service status
        </div>
        <div className="border-2 border-ink bg-paper p-1.5">
          <div className="border border-ink p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span
                className={`h-3 w-3 rounded-full ${up ? "bg-paid" : "bg-destructive"} ${
                  up ? "animate-pulse" : ""
                }`}
              />
              <h1 className="font-display text-[clamp(26px,4vw,38px)] font-semibold tracking-tight text-ink">
                {label}
              </h1>
            </div>

            <dl className="mt-7 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
              <Row k="Uptime" v={health ? fmtUptime(health.uptimeSeconds) : "—"} />
              <Row k="Datastore" v={health?.db ?? "—"} />
              <Row k="Settlement" v={health?.settles ?? "—"} />
              <Row k="Reasoning" v={health?.reasoning ?? "—"} />
              <Row k="Network" v={health?.network ?? "—"} />
              <Row k="Commit" v={health?.commit ?? "—"} />
            </dl>

            {health?.traction && (
              <>
                <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
                  Live traction
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
                  <Row k="Settled payments" v={health.traction.totalPayments.toLocaleString()} />
                  <Row k="Creator payouts" v={`$${health.traction.creatorPayoutsUsdc.toFixed(4)}`} />
                  <Row k="Creators earning" v={String(health.traction.creatorsEarning)} />
                  <Row k="Queries" v={health.traction.totalQueries.toLocaleString()} />
                </dl>
              </>
            )}

            <p className="mt-8 font-mono text-[10px] tracking-wide text-faint">
              Auto-refreshes every 10s
              {health?.time ? ` · checked ${new Date(health.time).toUTCString()}` : ""}
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className="tabular-nums text-ink">{v}</dd>
    </div>
  );
}
