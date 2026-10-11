"use client";
import { formatNumber, formatRecordedAmount } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";

/**
 * /status — uptime and settlement health. Polls /api/health and shows whether the
 * service is live, how long it's been up, the deployed commit, the settlement mode,
 * and headline traction. Read-only and safe to leave open — a tangible "this is a
 * real, running product" signal rather than a one-off hackathon demo.
 */

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { MonitoringStatusSection } from "@/components/keryx/monitoring-status-section";
import type { MonitoringObservations } from "@/lib/ops/monitoring-observations";
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
import {
  PendingReconciliationSection,
  type PendingReconciliationHealth,
} from "@/components/keryx/pending-reconciliation-section";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";

const message = createMessages("en");
const richMessage = createRichMessages("en");

interface Health {
  ok: boolean;
  status?: "operational" | "degraded";
  db: string;
  commit: string | null;
  uptimeSeconds: number;
  reasoning: string;
  settles: string;
  network: string;
  rpcProvider: string;
  time: string;
  registry?: RegistryHealth | null;
  dispatches?: DispatchHealth | null;
  settlement?: SettlementHealth | null;
  reconciliation?: PendingReconciliationHealth | null;
  monitoring?: MonitoringObservations;
  traction?: {
    totalPayments: number;
    creatorPayoutsUsdc: number;
    settledOperatingFeeUsdc?: number | null;
    settledOperatingFeePayments?: number | null;
    creatorsEarning: number;
    totalQueries: number;
  };
}

/** Selected public treasury observation; the legacy testnet view uses Circle App Kit. */
interface Treasury {
  available: boolean;
  observation?: { network: "eip155:5042"; address: string; availableUsdc: string | null } | null;
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
        const r = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(8_000) });
        const j = (await r.json()) as Health;
        if (alive) {
          setHealth(j);
          setReachable(true);
        }
      } catch {
        if (alive) { setReachable(false); setHealth(null); }
      }
    };
    // Gateway balance moves per-settlement, not per-second — poll it gently.
    const pollTreasury = async () => {
      try {
        const r = await fetch("/api/treasury", { cache: "no-store", signal: AbortSignal.timeout(8_000) });
        if (alive) {
          if (r.ok) setTreasury((await r.json()) as Treasury);
          else setTreasury(null);
        }
      } catch {
        // Never leave a formerly known mainnet observation displayed as current after a failed read.
        if (alive) setTreasury(null);
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

  const up = reachable && health?.ok && health.status !== "degraded";
  const label = !reachable ? message("statusPage.unreachable") : !health ? message("statusPage.checkingService") : up ? message("statusPage.serviceAvailable") : message("statusPage.degraded");

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-[760px] px-4 py-12 sm:px-[30px]">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">{message("statusPage.serviceStatus")}</div>
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
              <Row k={message("statusPage.uptime")} v={health ? fmtUptime(health.uptimeSeconds) : "—"} />
              <Row k={message("statusPage.datastore")} v={health?.db ?? "—"} />
              <Row k={message("statusPage.settlement")} v={health?.settles ?? "—"} />
              <Row k={message("statusPage.reasoning")} v={health?.reasoning ?? "—"} />
              <Row k={message("statusPage.network")} v={health?.network ?? "—"} />
              <Row k={message("statusPage.rpcProvider")} v={health?.rpcProvider ?? "—"} />
              <Row k={message("statusPage.commit")} v={health?.commit ?? "—"} />
            </dl>

            {health?.traction && (
              <>
                <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{message("statusPage.liveTraction")}</div>
                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
                  <Row k={message("statusPage.totalQueries")} v={formatNumber(health.traction.totalQueries)} />
                  <Row k={message("statusPage.settledPayments")} v={formatNumber(health.traction.totalPayments)} />
                  <Row k={message("statusPage.creatorRewards")} v={`$${formatRecordedAmount(health.traction.creatorPayoutsUsdc, { minimumFractionDigits: 4 })}`} />
                  <Row k={message("statusPage.creatorsEarning")} v={String(health.traction.creatorsEarning)} />
                  <Row k={message("statusPage.keryxOperatingFees")} v={health.traction.settledOperatingFeeUsdc != null ? `$${formatRecordedAmount(health.traction.settledOperatingFeeUsdc, { minimumFractionDigits: 6 })}` : message("statusPage.unavailable")} />
                  <Row k={message("statusPage.operatingFeeTransfers")} v={health.traction.settledOperatingFeePayments != null ? String(health.traction.settledOperatingFeePayments) : message("statusPage.unavailable")} />
                </dl>
              </>
            )}

            {health?.monitoring && <MonitoringStatusSection monitoring={health.monitoring} />}

            {health?.dispatches && <DispatchHealthSection dispatches={health.dispatches} />}

            {health?.registry && <RegistryStatusSection registry={health.registry} />}

            {health?.settlement && <SettlementProofSection settlement={health.settlement} />}

            {health?.reconciliation && (
              <PendingReconciliationSection reconciliation={health.reconciliation} />
            )}

            {treasury?.observation && (
              <>
                <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{message("statusPage.publicResearchTreasuryArcMainnet")}</div>
                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
                  <Row k={message("statusPage.gatewayAvailableUSDC")} v={treasury.observation.availableUsdc === null ? message("statusPage.unknown") : `$${treasury.observation.availableUsdc}`} />
                </dl>
                <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">{richMessage("statusPage.gatewayBalanceObservation", { addressPrefix: treasury.observation.address.slice(0, 6), addressSuffix: treasury.observation.address.slice(-4) })}</p>
              </>
            )}

            {treasury?.available && treasury.unifiedBalance && (
              <>
                <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{message("statusPage.settlementTreasuryUnifiedBalanceCircleAppKit")}</div>
                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
                  <Row
                    k={message("statusPage.confirmedAllChains")}
                    v={`$${treasury.unifiedBalance.totalConfirmedUsdc}`}
                  />
                  <Row k={message("statusPage.pendingDeposits")} v={`$${treasury.unifiedBalance.totalPendingUsdc}`} />
                  {treasury.unifiedBalance.perChain
                    .filter((c) => c.chain === "Arc_Testnet" || parseFloat(c.confirmed) > 0)
                    .map((c) => (
                      <Row key={c.chain} k={c.chain.replace(/_/g, " ")} v={`$${c.confirmed}`} />
                    ))}
                </dl>
                <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">{richMessage("statusPage.unifiedBalanceObservation", { gap: " ", addressPrefix: treasury.unifiedBalance.address.slice(0, 6), addressSuffix: treasury.unifiedBalance.address.slice(-4) })}</p>
              </>
            )}

            <p className="mt-8 font-mono text-[10px] tracking-wide text-faint">{richMessage("statusPage.refreshNotice", { checkedNotice: health?.time ? richMessage("statusPage.checkedAt", { checkedAt: <DisplayTime value={health.time} /> }) : "" })}</p>
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
