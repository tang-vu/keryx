"use client";
import { formatRecordedUsdc, selectPlural } from "@/lib/i18n/format";


/**
 * Live payments feed table: time, kind (fetch/citation badge), source, amount,
 * settled? (Circle Gateway settlement ID — batched on-chain on Arc), payer → payee.
 * Settlement IDs are Circle UUIDs (not EVM tx hashes), so they are NOT linked to a
 * per-tx explorer page; on-chain proof is the batched settlement wallet, linked in the header.
 */



import { DisplayTime } from "./display-time";
import { Check, CircleX, Clock3 } from "lucide-react";
import type { PaymentRecord } from "@/lib/types";
import { paymentSettlementStatus, pendingAuthorizationStatusLabel } from "@/lib/payments/payment-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { shortAddr } from "./phase-style";
import { cn } from "@/lib/utils";
import { GatewayContractReferences } from "./gateway-contract-references";
import { recordedArcLabel } from "@/lib/arc-network-display";
import { useUiMessages, useUiRichMessages } from "@/lib/i18n/ui-copy";






function timeAgo(iso: string) {
  return <DisplayTime value={iso} relative />;
}

export function PaymentsFeed({
  payments,
  compact = false,
}: {
  payments: PaymentRecord[];
  compact?: boolean;
}) {
  const uiCopy = useUiMessages();
  const dateCopy = useUiRichMessages();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="font-serif text-lg font-normal">
          {uiCopy("paymentRecords.title")}
        </CardTitle>
        <div className="flex items-center gap-3">
          <GatewayContractReferences records={payments} className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-paid hover:underline"/>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-paid">
            {uiCopy("paymentRecords.recorded")}
          </span>
        </div>
      </CardHeader>
      {compact ? (
        <CardContent className="space-y-2">
          {payments.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {uiCopy("paymentRecords.emptyCompact")}
            </p>
          )}
          {payments.map((p, i) => {
            const status = paymentSettlementStatus(p);
            return (
              <div
                key={p.id ?? `${p.payee}-${i}`}
                className="flex items-center gap-3 border-b border-line py-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium text-ink"
                    title={p.sourceName}
                  >
                    {p.sourceName}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-3">
                    {dateCopy("paymentRecords.compact", { age: timeAgo(p.createdAt), network: recordedArcLabel(p.network), kind: p.kind === "operating-fee" ? uiCopy("paymentRecords.operatingKind") : p.kind, status: status === "settled" ? uiCopy("paymentRecords.settledCompact") : status === "failed" ? uiCopy("paymentRecords.failedCompact") : status === "pending" ? pendingAuthorizationStatusLabel(p) : uiCopy("paymentRecords.simulated") })}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-mono text-sm font-semibold tabular-nums",
                    status === "failed"
                      ? "text-red-700"
                      : status === "pending"
                      ? "text-amber-700"
                      : "text-paid"
                  )}
                >
                  {formatRecordedUsdc(p.amountUsdc)}
                </span>
              </div>
            );
          })}
        </CardContent>
      ) : (
        <CardContent className="px-0">
          <p className="px-6 pb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {uiCopy("paymentRecords.batchBoundary")}
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-6">{uiCopy("paymentRecords.time")}</TableHead>
                  <TableHead>{uiCopy("paymentRecords.kind")}</TableHead>
                  <TableHead>{uiCopy("paymentRecords.source")}</TableHead>
                  <TableHead className="text-right">{uiCopy("paymentRecords.amount")}</TableHead>
                  <TableHead>{uiCopy("paymentRecords.flow")}</TableHead>
                  <TableHead className="pr-6">{uiCopy("paymentRecords.settled")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      {uiCopy("paymentRecords.empty")}
                    </TableCell>
                  </TableRow>
                )}
                {payments.map((p, i) => (
                  <TableRow key={p.id ?? `${p.payee}-${i}`}>
                    <TableCell className="pl-6 font-mono text-xs text-muted-foreground">
                      {timeAgo(p.createdAt)}
                    </TableCell>
                    <TableCell>
                      <KindBadge kind={p.kind} />
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm font-medium">
                      {p.sourceName}
                      <span className="mt-1 block font-mono text-[11px] font-normal text-muted-foreground">{recordedArcLabel(p.network)}</span>
                      {p.kind === "operating-fee" && <span className="mt-1 block whitespace-normal text-[11px] font-normal text-muted-foreground">{uiCopy("paymentRecords.operatingBoundary")}</span>}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-sm font-semibold tabular-nums",
                        paymentSettlementStatus(p) === "failed"
                          ? "text-red-700"
                          : "text-paid"
                      )}
                    >
                      {formatRecordedUsdc(p.amountUsdc)}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {shortAddr(p.payer)} → {shortAddr(p.payee)}
                    </TableCell>
                    <TableCell className="pr-6">
                      {paymentSettlementStatus(p) === "settled" && p.txHash ? (
                        <span
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-paid"
                          title={uiCopy("paymentRecords.settlementTitle", { reference: p.txHash })}
                        >
                          <Check className="h-3 w-3" />
                          {uiCopy("paymentRecords.batched")}
                        </span>
                      ) : paymentSettlementStatus(p) === "failed" ? (
                        <span
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-red-700"
                          title={
                            p.txHash ? uiCopy("paymentRecords.transferTitle", { reference: p.txHash }) : undefined
                          }
                        >
                          <CircleX className="h-3 w-3" />
                          {uiCopy("paymentRecords.failed")}
                        </span>
                      ) : paymentSettlementStatus(p) === "pending" ? (
                        <span
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-amber-700"
                          title={
                            p.authorizationId
                              ? uiCopy("paymentRecords.authorizationTitle", { reference: p.authorizationId })
                              : undefined
                          }
                        >
                          <Clock3 className="h-3 w-3" />
                          {pendingAuthorizationStatusLabel(p)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {uiCopy("paymentRecords.simulated")}
                        </span>
                      )}
                      {(p.txHash || p.authorizationId) && <span className="mt-2 block max-w-60 break-all font-mono text-[11px] text-muted-foreground">{uiCopy(p.txHash ? "paymentRecords.recordedReference" : "paymentRecords.authorizationReference", { reference: p.txHash ?? p.authorizationId ?? "" })}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function KindBadge({ kind }: { kind: PaymentRecord["kind"] }) {
  const uiCopy = useUiMessages();
  const citation = kind === "citation";
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
        citation
          ? "border-seal/30 bg-seal/10 text-seal"
          : "border-ink-3/40 bg-paper-2 text-ink-2"
      )}
    >
      {kind === "operating-fee" ? uiCopy("paymentRecords.operatingBadge") : kind}
    </span>
  );
}
