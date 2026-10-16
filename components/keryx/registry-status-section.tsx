"use client";

import { browserPaymentProfile } from "@/lib/browser-payment-profile";


import { formatNumber, selectPlural } from "@/lib/i18n/format";
import { DisplayTime } from "./display-time";
import type { ReactNode } from "react";
import { useUiMessages, useUiRichMessages } from "@/lib/i18n/ui-copy";






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

function ago(iso: string) {
  return <DisplayTime value={iso} relative />;
}

export function RegistryStatusSection({ registry }: { registry: RegistryHealth }) {
  const message = useUiMessages();
  const richMessage = useUiRichMessages();
  const { parity } = registry;
  const parityLabel = !parity
    ? message("statusRegistry.notYetChecked")
    : parity.issueCount === 0
      ? richMessage("statusRegistry.parityMatch", { compared: formatNumber(parity.comparedCount), checkedAgo: ago(parity.checkedAt) })
      : richMessage(selectPlural(parity.issueCount) === "one" ? "statusRegistry.mismatch.one" : "statusRegistry.mismatch.other", { count: formatNumber(parity.issueCount), checkedAgo: ago(parity.checkedAt) });

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
        <Row k={message("statusRegistry.sourcesOnChain")} v={parity ? formatNumber(parity.chainCount) : "—"} />
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

function Row({ k, v, alert = false }: { k: string; v: ReactNode; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`tabular-nums ${alert ? "text-destructive" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
