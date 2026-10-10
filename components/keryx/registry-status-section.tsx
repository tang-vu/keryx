"use client";

import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

/**
 * /status section for the on-chain SourceRegistry: the contract (linked to ArcScan),
 * how many sources live on it, and the latest parity-watchdog verdict — whether the
 * DB cache the agent pays from still matches the chain, field by field. The watchdog
 * (scripts/check-registry.mts, hourly) writes the summary; /api/health serves it here.
 */

/** Mirrors the `registry` object /api/health returns. */
export interface RegistryHealth {
  address: string;
  lastSyncedBlock: string | null;
  parity: {
    checkedAt: string;
    chainCount: number;
    comparedCount: number;
    issueCount: number;
    /** Optional while an older watchdog summary survives a rolling deploy. */
    headBlock?: string;
  } | null;
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return message("statusRegistry.justNow");
  if (mins < 60) return message("statusObservation.minutesAgo", { minutes: mins });
  const h = Math.floor(mins / 60);
  return h < 48 ? message("statusObservation.hoursAgo", { hours: h }) : message("statusObservation.daysAgo", { days: Math.floor(h / 24) });
}

export function RegistryStatusSection({ registry }: { registry: RegistryHealth }) {
  const { parity } = registry;
  const parityLabel = !parity
    ? message("statusRegistry.notYetChecked")
    : parity.issueCount === 0
      ? message("statusRegistry.parityMatch", { compared: parity.comparedCount, checkedAgo: ago(parity.checkedAt) })
      : message(parity.issueCount === 1 ? "statusRegistry.mismatch.one" : "statusRegistry.mismatch.other", { count: parity.issueCount, checkedAgo: ago(parity.checkedAt) });

  return (
    <>
      <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{message("statusRegistry.sourceRegistryOnChain")}</div>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
        <div className="flex flex-col gap-1">
          <dt className="text-ink-3">{message("statusRegistry.contract")}</dt>
          <dd className="tabular-nums text-ink">
            <a
              href={`${browserPaymentProfile().explorerUrl}/address/${registry.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              title={message("statusRegistry.sourceRegistryOnArcScan")}
            >
              {registry.address.slice(0, 6)}…{registry.address.slice(-4)}
            </a>
          </dd>
        </div>
        <Row k={message("statusRegistry.sourcesOnChain")} v={parity ? String(parity.chainCount) : "—"} />
        <Row
          k={message("statusRegistry.chainCacheParity")}
          v={parityLabel}
          alert={parity !== null && parity.issueCount > 0}
        />
        <Row k={message("statusRegistry.rPCHead")} v={parity?.headBlock ?? "—"} />
        <Row k={message("statusRegistry.indexedBlock")} v={registry.lastSyncedBlock ?? "—"} />
      </dl>
      <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">{message("statusRegistry.theRecordedSweepReadsEveryRegistryRecordBack")}</p>
    </>
  );
}

function Row({ k, v, alert = false }: { k: string; v: string; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`tabular-nums ${alert ? "text-destructive" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
