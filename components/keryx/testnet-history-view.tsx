import Link from "next/link";
import type { TestnetArchiveInfo, TestnetArchiveSummary, TestnetCreatorEntry } from "@/lib/history/testnet-archive";
import { formatUsdcMicros } from "@/lib/display/recorded-usdc";
import { shortAddr } from "./phase-style";

function CreatorRows({ rows, start = 0 }: { rows: TestnetCreatorEntry[]; start?: number }) {
  return <ol start={start + 1} className="divide-y divide-line">
    {rows.map((row, index) => <li key={`${row.sourceId}:${row.walletAddress}`} className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-3 sm:grid-cols-[20px_minmax(0,1fr)_auto]">
      <span className="mt-1 w-5 shrink-0 font-mono text-xs text-seal">{start + index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-serif text-base text-ink">{row.sourceName}</p>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-ink-3">
          {/^(?:0x)[a-fA-F0-9]{40}$/.test(row.walletAddress)
            ? <a href={`https://testnet.arcscan.app/address/${row.walletAddress}`} target="_blank" rel="noopener noreferrer" className="underline" aria-label={`Inspect original testnet wallet ${row.walletAddress}`}>{shortAddr(row.walletAddress)} ↗</a>
            : <span>{shortAddr(row.walletAddress)}</span>}
          {" · "}{row.citationCount.toLocaleString("en-US")} cites · {row.paymentCount.toLocaleString("en-US")} payments
        </p>
      </div>
      <span className="col-start-2 font-mono text-xs tabular-nums text-paid sm:col-start-3 sm:row-start-1 sm:mt-1">{formatUsdcMicros(row.totalEarnedMicroUsdc, { denomination: "test USDC" })}</span>
    </li>)}
  </ol>;
}

export function TestnetCreatorLeaderboard({ rows, expanded = false }: { rows: TestnetCreatorEntry[]; expanded?: boolean }) {
  return <div id="testnet-creators" className="mt-5 border-t border-line pt-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-display text-xl text-ink">Testnet creator leaderboard</h3>
      <a href="/api/history/testnet/creators" className="min-h-11 py-3 font-mono text-xs text-seal underline">Download creator data →</a>
    </div>
    <p className="text-xs leading-relaxed text-ink-3">Ranked by settled access and citation payments to each original source and wallet. Historical listings do not establish current publisher control.</p>
    {rows.length ? <>
      <CreatorRows rows={expanded ? rows : rows.slice(0, 5)} />
      {!expanded && rows.length > 5 && <details className="mt-2 border-t border-line">
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-seal">Show all {rows.length} source / wallet entries</summary>
        <CreatorRows rows={rows.slice(5)} start={5} />
      </details>}
    </> : <p className="mt-3 text-sm text-ink-2">No settled creator payments in this snapshot.</p>}
  </div>;
}

export function TestnetHistorySummary({ info, summary, creators, expandedCreators = false }: {
  info: TestnetArchiveInfo; summary: TestnetArchiveSummary; creators?: TestnetCreatorEntry[] | null; expandedCreators?: boolean;
}) {
  const inbound = summary.paymentKinds.find(kind => kind.kind === "inbound");
  return <section id="testnet-history" className="mt-8 border-t-2 border-seal bg-paper-2 p-5 sm:p-6" aria-label="Historical Arc testnet evidence">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-mono text-[11px] uppercase tracking-[0.15em] text-seal">The track record</p><h2 className="mt-2 font-display text-2xl text-ink">Arc testnet history</h2></div>
      <Link href="/history/testnet" className="min-h-11 border border-ink px-4 py-3 text-sm text-ink hover:underline">Browse all old questions →</Link>
    </div>
    <p className="mt-3 text-sm leading-relaxed text-ink-2">Recorded reading and creator payments from {summary.earliestQueryAt?.slice(0, 10)} to {summary.latestQueryAt?.slice(0, 10)}. Original testnet evidence is retained alongside current mainnet activity.</p>
    <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4">
      <div><dt className="text-xs text-ink-3">Recorded questions</dt><dd className="mt-1 font-display text-3xl text-ink">{summary.totalQueryRuns.toLocaleString("en-US")}</dd></div>
      <div><dt className="text-xs text-ink-3">Settled creator payments</dt><dd className="mt-1 font-display text-3xl text-ink">{summary.settledCreatorPaymentCount.toLocaleString("en-US")}</dd></div>
      <div><dt className="text-xs text-ink-3">Settled to creator wallets</dt><dd className="mt-1 break-words font-display text-2xl text-paid">{formatUsdcMicros(summary.settledCreatorMicroUsdc, { denomination: "test USDC" })}</dd></div>
      <div><dt className="text-xs text-ink-3">Creator wallets paid</dt><dd className="mt-1 font-display text-3xl text-ink">{summary.settledCreatorCount.toLocaleString("en-US")}</dd></div>
    </dl>
    <p className="mt-4 text-xs leading-relaxed text-ink-3">Testnet USDC, separate from mainnet. Includes owner-operated activity; these totals do not establish independent customers or event-period growth.</p>
    {creators !== undefined && (creators === null
      ? <p role="status" className="mt-5 text-sm text-ink-2">Testnet creator leaderboard temporarily unavailable. <Link href="/history/testnet" className="text-seal underline">Open history to retry.</Link></p>
      : <TestnetCreatorLeaderboard rows={creators} expanded={expandedCreators} />)}
    <details className="mt-5 border-t border-line pt-1">
      <summary className="min-h-11 cursor-pointer py-3 text-sm text-ink-2">Inspect archived totals and channels</summary>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs text-ink-2">
        {(["settled", "pending", "failed", "simulated"] as const).map(status => <div key={status} className="contents"><dt className="capitalize">{status} payment records</dt><dd className="text-right font-mono">{summary.payments[status].count.toLocaleString("en-US")} · {formatUsdcMicros(summary.payments[status].amountMicroUsdc, { denomination: "test USDC" })}</dd></div>)}
        {inbound && <><dt>Service receipts (separate from creator payments)</dt><dd className="font-mono">{inbound.count.toLocaleString("en-US")}</dd></>}
        {summary.paymentKinds.map(kind => <div key={kind.kind} className="contents"><dt>{kind.kind} records · settled amount</dt><dd className="text-right font-mono">{kind.count.toLocaleString("en-US")} · {formatUsdcMicros(kind.settledMicroUsdc, { denomination: "test USDC" })}</dd></div>)}
        {summary.origins.map(channel => <div key={channel.origin ?? "unknown"} className="contents"><dt>{channel.origin ?? "Unknown channel"} questions</dt><dd className="font-mono">{channel.count.toLocaleString("en-US")}</dd></div>)}
      </dl>
      <p className="mt-4 break-words text-xs leading-relaxed text-ink-3">Snapshot captured {info.capturedAt}. Settlement states are frozen at capture time. Wallets and channels are recorded identities, not independent people.</p>
      <div className="mt-3 flex flex-wrap gap-x-5 text-xs text-seal">
        <a href="/api/history/testnet" className="min-h-11 py-3 underline">Archive data</a>
        <a href="https://github.com/tang-vu/keryx/blob/main/docs/tameion-submission.md" className="min-h-11 py-3 underline">Event-period evidence</a>
      </div>
    </details>
  </section>;
}
