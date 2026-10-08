import Link from "next/link";
import { getTestnetArchive, type TestnetArchiveInfo, type TestnetArchiveSummary } from "@/lib/history/testnet-archive";

export function TestnetHistorySummary({ info, summary }: { info: TestnetArchiveInfo; summary: TestnetArchiveSummary }) {
  const inbound = summary.paymentKinds.find(kind => kind.kind === "inbound");
  return <section className="mt-8 border border-line bg-paper p-5" aria-label="Historical Arc testnet evidence">
    <h2 className="font-display text-xl text-ink">Arc testnet history</h2>
    <p className="mt-2 text-sm leading-relaxed text-ink-2">Retained records from {summary.earliestQueryAt?.slice(0, 10)} to {summary.latestQueryAt?.slice(0, 10)}. Snapshot captured {info.capturedAt}. Amounts below are testnet USDC, separate from the current mainnet ledger.</p>
    <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div><dt className="text-xs text-ink-3">Recorded questions</dt><dd className="font-serif text-xl">{summary.totalQueryRuns.toLocaleString("en-US")}</dd></div>
      <div><dt className="text-xs text-ink-3">Settled creator payments</dt><dd className="font-serif text-xl">{summary.settledCreatorPaymentCount.toLocaleString("en-US")}</dd></div>
      <div><dt className="text-xs text-ink-3">Settled to creator wallets</dt><dd className="font-serif text-xl">{(summary.settledCreatorMicroUsdc / 1_000_000).toFixed(6)} test USDC</dd></div>
      <div><dt className="text-xs text-ink-3">Pending payments</dt><dd className="font-serif text-xl">{summary.payments.pending.count}</dd></div>
    </dl>
    <p className="mt-3 text-xs leading-relaxed text-ink-3">{inbound ? `${inbound.count} recorded service receipts are counted separately from creator payments. ` : ""}Recorded channel totals include owner-operated activity; they do not establish independent customers or event-period growth. Settlement states are frozen at capture time.</p>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-seal">
      <Link href="/history/testnet" className="underline underline-offset-4">Browse all old questions →</Link>
      <a href="/api/history/testnet" className="underline underline-offset-4">Archive data</a>
      <a href="https://github.com/tang-vu/keryx/blob/main/docs/tameion-submission.md" className="underline underline-offset-4">Event-period evidence</a>
    </div>
  </section>;
}

export async function HistoricalHistorySection() {
  let data: { info: TestnetArchiveInfo; summary: TestnetArchiveSummary } | null = null;
  let unavailable = false;
  try {
    const archive = await getTestnetArchive();
    if (archive) data = { info: archive.info, summary: await archive.summary() };
  } catch { unavailable = true; }
  if (unavailable) return <section className="mt-8 border border-line p-5"><h2 className="font-display text-xl">Arc testnet history</h2><p role="status" className="mt-2 text-sm">Historical evidence is temporarily unavailable. <Link href="/history/testnet" className="underline">Open history to retry.</Link></p></section>;
  return data ? <TestnetHistorySummary {...data} /> : null;
}
