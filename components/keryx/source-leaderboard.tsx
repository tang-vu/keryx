"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRecordedUsdc } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";
import type { SourceLeaderboard as SourceLeaderboardData } from "@/lib/sources/source-leaderboard";
import { shortAddr } from "./phase-style";

const copy = createMessages("en");

/** Source identity and fee beneficiary are separate: a shared wallet never collapses rows. */
export function SourceLeaderboard({ data, network }: { data: SourceLeaderboardData; network: string }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const rows = data.rows.filter(row => !needle || `${row.sourceName} ${row.sourceId} ${row.walletAddress ?? ""} ${row.feeBeneficiaries.join(" ")}`.toLocaleLowerCase().includes(needle));
  return <Card>
    <CardHeader className="space-y-2 pb-4">
      <CardTitle className="flex items-center gap-2 font-serif text-lg font-normal"><Trophy className="h-4 w-4 text-seal" />{copy("sourceLeaderboard.title", { network })}</CardTitle>
      <p className="text-xs text-muted-foreground">{copy("sourceLeaderboard.catalog", { count: data.rows.length })}</p>
      <p className="text-xs text-muted-foreground">{copy("sourceLeaderboard.feeBoundary")}</p>
      {data.catalogStatus !== "ready" && <p role="status" className="text-xs text-muted-foreground">{copy("sourceLeaderboard.catalogUnavailable")}</p>}
      {data.operatingFeesStatus !== "ready" && <p role="status" className="text-xs text-muted-foreground">{copy("sourceLeaderboard.feesUnavailable")}</p>}
      <input aria-label={copy("sourceLeaderboard.searchLabel")} placeholder={copy("sourceLeaderboard.searchPlaceholder")} value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm" />
    </CardHeader>
    <CardContent>
      <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1" aria-label={copy("sourceLeaderboard.rowsLabel")}>
        {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{copy("sourceLeaderboard.empty")}</p>}
        {rows.map(row => <div key={row.sourceId} className="rounded-lg border border-line px-3 py-2.5" data-source-id={row.sourceId}>
          <Link href={row.href} className="block truncate font-serif text-[15px] text-ink hover:underline">{row.sourceName}</Link>
          <p className="mt-1 text-[11px] text-ink-3">{row.kind === "creator" ? copy("sourceLeaderboard.creatorIdentity", { wallet: row.walletAddress ? shortAddr(row.walletAddress) : copy("sourceLeaderboard.walletUnknown") }) : row.kind === "paper" ? copy("sourceLeaderboard.paper") : copy("sourceLeaderboard.publicSource")}</p>
          <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
            <span>{copy("sourceLeaderboard.creatorRewards")} <strong className="font-mono text-paid">{formatRecordedUsdc(row.creatorEarnedUsdc)}</strong> · {copy("sourceLeaderboard.creatorCounts", { citations: row.citationCount, payments: row.paymentCount })}</span>
            <span>{copy("sourceLeaderboard.ownerFee")} <strong className="font-mono text-paid">{row.operatingFeeUsdc === null ? copy("sourceLeaderboard.unknown") : formatRecordedUsdc(row.operatingFeeUsdc)}</strong>{row.operatingFeeCitationCount !== null && <> · {copy("sourceLeaderboard.feeCounts", { citations: row.operatingFeeCitationCount, payments: row.operatingFeePaymentCount! })}</>}</span>
          </div>
          {row.feeBeneficiaries.length > 0 && <p className="mt-1 font-mono text-[11px] text-ink-3">{copy("sourceLeaderboard.feeRecipient", { wallets: row.feeBeneficiaries.map(shortAddr).join(", ") })}</p>}
        </div>)}
      </div>
    </CardContent>
  </Card>;
}
