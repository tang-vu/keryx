"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRecordedUsdc } from "@/lib/i18n/format";
import type { SourceLeaderboard as SourceLeaderboardData } from "@/lib/sources/source-leaderboard";
import { shortAddr } from "./phase-style";

/** Source identity and fee beneficiary are separate: a shared wallet never collapses rows. */
export function SourceLeaderboard({ data, network }: { data: SourceLeaderboardData; network: string }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const rows = data.rows.filter(row => !needle || `${row.sourceName} ${row.sourceId} ${row.walletAddress ?? ""} ${row.feeBeneficiaries.join(" ")}`.toLocaleLowerCase().includes(needle));
  return <Card>
    <CardHeader className="space-y-2 pb-4">
      <CardTitle className="flex items-center gap-2 font-serif text-lg font-normal"><Trophy className="h-4 w-4 text-seal" />{network} source leaderboard</CardTitle>
      <p className="text-xs text-muted-foreground">All {data.rows.length} catalog and settled sources. Each source has its own row, including sources with no payments.</p>
      <p className="text-xs text-muted-foreground">Creator rewards go to the creator. Owner fees are Keryx transfers attributed to cited sources; they are not publisher earnings. One transfer may contribute to several rows.</p>
      {data.catalogStatus !== "ready" && <p role="status" className="text-xs text-muted-foreground">Retained feed catalog unavailable; this list is incomplete.</p>}
      {data.operatingFeesStatus !== "ready" && <p role="status" className="text-xs text-muted-foreground">Source fee totals are unavailable: some settlement or public allocation evidence is missing.</p>}
      <input aria-label="Search leaderboard sources" placeholder="Search sources or wallets" value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm" />
    </CardHeader>
    <CardContent>
      <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1" aria-label="All source leaderboard rows">
        {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No matching sources.</p>}
        {rows.map(row => <div key={row.sourceId} className="rounded-lg border border-line px-3 py-2.5" data-source-id={row.sourceId}>
          <Link href={row.href} className="block truncate font-serif text-[15px] text-ink hover:underline">{row.sourceName}</Link>
          <p className="mt-1 text-[11px] text-ink-3">{row.kind === "creator" ? `Creator · ${row.walletAddress ? shortAddr(row.walletAddress) : "Wallet not recorded"}` : row.kind === "paper" ? "Public paper metadata" : "Public source"}</p>
          <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
            <span>Creator rewards <strong className="font-mono text-paid">{formatRecordedUsdc(row.creatorEarnedUsdc)}</strong> · {row.citationCount} cites · {row.paymentCount} pmts</span>
            <span>Owner fee <strong className="font-mono text-paid">{row.operatingFeeUsdc === null ? "Unknown" : formatRecordedUsdc(row.operatingFeeUsdc)}</strong>{row.operatingFeeCitationCount !== null && ` · ${row.operatingFeeCitationCount} cites · ${row.operatingFeePaymentCount} transfers`}</span>
          </div>
          {row.feeBeneficiaries.length > 0 && <p className="mt-1 font-mono text-[11px] text-ink-3">Fee recipient: {row.feeBeneficiaries.map(shortAddr).join(", ")}</p>}
        </div>)}
      </div>
    </CardContent>
  </Card>;
}
