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
import {
  RegistryStatusSection,
  type RegistryHealth,
} from "@/components/keryx/registry-status-section";
import {
  DispatchHealthSection,
  type DispatchHealth,
} from "@/components/keryx/dispatch-health-section";
import {
  SettlementProofSection,
  type SettlementHealth,
} from "@/components/keryx/settlement-proof-section";

interface Health {
  ok: boolean;
  db: string;
  commit: string | null;
  uptimeSeconds: number;
  reasoning: string;
  settles: string;
  network: string;
  time: string;
  registry?: RegistryHealth | null;
  dispatches?: DispatchHealth | null;
  settlement?: SettlementHealth | null;
  traction?: {
    totalPayments: number;
    creatorPayoutsUsdc: number;
    creatorsEarning: number;
    totalQueries: number;
    externalQueries: number;
    externalPayingQueries: number;
    returningExternalActors: number;
    externalSettlementSuccessRate: number;
    externalSettlementAttempts: number;
  };
}

/** Shape of /api/treasury — Gateway balance via Circle App Kit (Unified Balance Kit). */
interface Treasury {
  available: boolean;
  unifiedBalance: {
    address: string;
    totalConfirmedUsdc: string;
    totalPendingUsdc: string;
    perChain: { chain: string; confirmed: string; pending: string }[];
  } | null;
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
  const [treasury, setTreasury] = useState<Treasury | null>(null);
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
    // Gateway balance moves per-settlement, not per-second — poll it gently.
    const pollTreasury = async () => {
      try {
        const r = await fetch("/api/treasury", { cache: "no-store" });
        if (r.ok && alive) setTreasury((await r.json()) as Treasury);
      } catch {
        /* section simply stays hidden */
      }
    };
    poll();
    pollTreasury();
    const id = setInterval(poll, 10_000);
    const tid = setInterval(pollTreasury, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(tid);
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
                  <Row k="External queries" v={health.traction.externalQueries.toLocaleString()} />
                  <Row
                    k="External paid"
                    v={health.traction.externalPayingQueries.toLocaleString()}
                  />
                  <Row
                    k="Returning actors"
                    v={health.traction.returningExternalActors.toLocaleString()}
                  />
                  <Row
                    k="Settlement success"
                    v={
                      health.traction.externalSettlementAttempts > 0
                        ? `${Math.round(
                            health.traction.externalSettlementSuccessRate * 100,
                          )}%`
                        : "collecting"
                    }
                  />
                  <Row k="All queries" v={health.traction.totalQueries.toLocaleString()} />
                </dl>
              </>
            )}

            {health?.dispatches && <DispatchHealthSection dispatches={health.dispatches} />}

            {health?.registry && <RegistryStatusSection registry={health.registry} />}

            {health?.settlement && <SettlementProofSection settlement={health.settlement} />}

            {treasury?.available && treasury.unifiedBalance && (
              <>
                <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
                  Settlement treasury — unified balance · Circle App Kit
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
                  <Row
                    k="Confirmed (all chains)"
                    v={`$${treasury.unifiedBalance.totalConfirmedUsdc}`}
                  />
                  <Row k="Pending deposits" v={`$${treasury.unifiedBalance.totalPendingUsdc}`} />
                  {treasury.unifiedBalance.perChain
                    .filter((c) => c.chain === "Arc_Testnet" || parseFloat(c.confirmed) > 0)
                    .map((c) => (
                      <Row key={c.chain} k={c.chain.replace(/_/g, " ")} v={`$${c.confirmed}`} />
                    ))}
                </dl>
                <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">
                  Chain-abstracted Gateway balance of the agent&apos;s settlement wallet{" "}
                  {treasury.unifiedBalance.address.slice(0, 6)}…
                  {treasury.unifiedBalance.address.slice(-4)}, read via
                  @circle-fin/unified-balance-kit.
                </p>
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
