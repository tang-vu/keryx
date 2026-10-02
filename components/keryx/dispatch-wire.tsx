"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PaymentRecord } from "@/lib/types";
import { paymentSettlementStatus } from "@/lib/payments/payment-state";
import { recordedArcLabel } from "@/lib/arc-network-display";

type State = "loading" | "ready" | "empty" | "error";

export function DispatchWire() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [state, setState] = useState<State>("loading");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const response = await fetch("/api/payments?limit=50", { cache: "no-store" });
      if (!response.ok) throw new Error("Payment feed unavailable");
      const body = await response.json();
      if (!Array.isArray(body.payments)) throw new Error("Invalid payment feed");
      const settled = (body.payments as PaymentRecord[]).filter((p) =>
        p.kind === "citation" && p.settled === true && paymentSettlementStatus(p) === "settled" && p.amountUsdc > 0,
      ).slice(0, 12);
      if (id !== requestId.current) return;
      setPayments(settled);
      setState(settled.length ? "ready" : "empty");
    } catch {
      if (id !== requestId.current) return;
      setPayments([]);
      setState("error");
    }
  }, []);

  useEffect(() => {
    const requests = requestId;
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); requests.current++; };
  }, [load]);

  return (
    <div className="flex h-10 items-center border-b border-ink bg-panel">
      <div className="flex h-10 shrink-0 items-center bg-ink px-2 font-mono text-[10px] uppercase tracking-wider text-paper sm:px-4"><span className="sm:hidden">Settled</span><span className="hidden sm:inline">Settled citations</span></div>
      <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2 font-mono text-[11px] text-ink-2 sm:px-3" aria-live="polite">
        {state === "loading" && "Loading settlements…"}
        {state === "empty" && "No recent settled citations."}
        {state === "error" && "Payment feed unavailable."}
        {state === "ready" && (
          <div className="flex w-max gap-6 whitespace-nowrap">
            {payments.map((p) => <span key={p.id ?? `${p.queryId}-${p.sourceId}-${p.createdAt}`} className="flex items-center gap-2"><span className="text-seal">PAID</span><span>{p.sourceName}</span><span className="text-paid">${p.amountUsdc.toFixed(6)} USDC</span><span>{recordedArcLabel(p.network)}</span></span>)}
          </div>
        )}
      </div>
      {state === "error" && <button type="button" onClick={() => { setState("loading"); void load(); }} className="min-h-11 shrink-0 px-3 font-mono text-[10px] uppercase text-ink underline">Retry</button>}
    </div>
  );
}
