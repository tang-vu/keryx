"use client";


import { formatRecordedUsdc } from "@/lib/i18n/format";

import type { PaymentRecord } from "@/lib/types";
import { paymentSettlementStatus } from "@/lib/payments/payment-state";
import { recordedArcLabel } from "@/lib/arc-network-display";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { useLedgerResource } from "@/lib/hooks/use-ledger-resource";





type State = "loading" | "ready" | "empty" | "error";

function settledCitations(body: unknown): PaymentRecord[] {
  if (!body || typeof body !== "object" || !("payments" in body) || !Array.isArray(body.payments)) throw new Error("Invalid payment feed");
  return (body.payments as PaymentRecord[]).filter((p) =>
    p.kind === "citation" && p.settled === true && paymentSettlementStatus(p) === "settled" && p.amountUsdc > 0,
  ).slice(0, 12);
}

export function DispatchWire() {
  const copy = useUiMessages();
  const resource = useLedgerResource("/api/payments?limit=50", settledCitations, true, 30_000);
  const payments = resource.data ?? [];
  const state: State = resource.retrying || resource.status === "loading" ? "loading"
    : resource.status === "error" ? "error" : payments.length ? "ready" : "empty";

  if (state === "empty") return null;

  return (
    <div className="flex h-10 items-center border-b border-ink bg-panel">
      <div className="flex h-10 shrink-0 items-center bg-ink px-2 font-mono text-[10px] uppercase tracking-wider text-paper sm:px-4"><span className="sm:hidden">{copy("dispatchWire.settled")}</span><span className="hidden sm:inline">{copy("dispatchWire.citations")}</span></div>
      <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 font-mono text-[11px] text-ink-2 sm:px-3" aria-live="polite">
        {state === "loading" && copy("dispatchWire.loading")}
        {state === "error" && copy("dispatchWire.unavailable")}
        {state === "ready" && (
          <div className="flex w-max gap-6 whitespace-nowrap">
            {payments.map((p) => <span key={p.id ?? `${p.queryId}-${p.sourceId}-${p.createdAt}`} className="flex items-center gap-2"><span className="text-seal">{copy("dispatchWire.paid")}</span><span>{p.sourceName}</span><span className="text-paid">{formatRecordedUsdc(p.amountUsdc, { minimumFractionDigits: 6 })} USDC</span><span>{recordedArcLabel(p.network)}</span></span>)}
          </div>
        )}
      </div>
      {state === "error" && <button type="button" onClick={resource.retry} className="min-h-11 shrink-0 px-3 font-mono text-[10px] uppercase text-ink underline">{copy("dispatchWire.retry")}</button>}
    </div>
  );
}
