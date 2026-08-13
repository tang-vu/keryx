"use client";

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
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function RegistryStatusSection({ registry }: { registry: RegistryHealth }) {
  const { parity } = registry;
  const parityLabel = !parity
    ? "not yet checked"
    : parity.issueCount === 0
      ? `${parity.comparedCount}/${parity.comparedCount} match · ${ago(parity.checkedAt)}`
      : `${parity.issueCount} mismatch${parity.issueCount === 1 ? "" : "es"} · ${ago(parity.checkedAt)}`;

  return (
    <>
      <div className="mt-8 border-t border-line pt-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
        Source registry — on-chain
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-[12px]">
        <div className="flex flex-col gap-1">
          <dt className="text-ink-3">Contract</dt>
          <dd className="tabular-nums text-ink">
            <a
              href={`https://testnet.arcscan.app/address/${registry.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              title="SourceRegistry on ArcScan"
            >
              {registry.address.slice(0, 6)}…{registry.address.slice(-4)}
            </a>
          </dd>
        </div>
        <Row k="Sources on-chain" v={parity ? String(parity.chainCount) : "—"} />
        <Row
          k="Chain ↔ cache parity"
          v={parityLabel}
          alert={parity !== null && parity.issueCount > 0}
        />
        <Row k="RPC head" v={parity?.headBlock ?? "—"} />
        <Row k="Indexed block" v={registry.lastSyncedBlock ?? "—"} />
      </dl>
      <p className="mt-3 font-mono text-[10px] tracking-wide text-faint">
        Hourly sweep reads every registry record back and compares payout wallet, author
        splits, price, and active flag against the cache the agent pays from.
      </p>
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
