"use client";

import { useMemo } from "react";
import type { QueryRun, PaymentRecord } from "@/lib/types";
import { ReasoningConsole } from "@/components/keryx/reasoning-console";
import { CreatorsPaidPanel } from "@/components/keryx/creators-paid-panel";
import { AnswerCard } from "@/components/keryx/answer-card";

export function DispatchView({
  run,
  payments,
}: {
  run: QueryRun;
  payments: PaymentRecord[];
}) {
  // Prefer the real settlement rows (carry settled / tx) so the permalink shows
  // on-chain truth. Fall back to a citation reconstruction only for older runs
  // that predate per-query payment rows.
  const payouts = useMemo<PaymentRecord[]>(() => {
    if (payments.length) return payments;
    if (!run.citations?.length) return [];
    return run.citations.map((c) => ({
      kind: "citation" as const,
      queryId: run.id,
      sourceId: c.sourceId,
      sourceName: c.sourceName,
      payer: "0xAGENT",
      payee: c.sourceId,
      amountUsdc: c.reward,
      weight: c.weight,
      txHash: null,
      network: "",
      settled: false,
      createdAt: run.createdAt,
    }));
  }, [run, payments]);

  // "real" lights up the on-chain settlement link; offline stays honest as simulated.
  const mode = payouts.some((p) => p.settled) ? "real" : "offline";

  return (
    <>
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
        Archived dispatch
      </div>
      <div className="mb-7 max-w-[860px]">
        <p className="font-serif text-[clamp(17px,1.5vw,20px)] leading-[1.55] text-ink-2">
          {run.question}
        </p>
        <p className="mt-2 font-mono text-[10px] text-ink-3">
          {new Date(run.createdAt).toLocaleString()} · {run.engine}
        </p>
      </div>

      <h2 className="mb-7 border-b border-ink pb-3.5 font-display text-[clamp(24px,3.2vw,34px)] font-medium tracking-tight text-ink">
        The dispatch, <em className="italic text-paid">itemised.</em>
      </h2>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <ReasoningConsole steps={run.trace} streaming={false} budget={run.budget} />
        <CreatorsPaidPanel payments={payouts} mode={mode} streaming={false} />
      </div>

      <div className="mt-6">
        <AnswerCard run={run} meta={null} />
      </div>
    </>
  );
}
