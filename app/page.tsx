"use client";

/**
 * Ask — the hero screen. A question + budget opens an SSE stream and renders
 * the agent's live reasoning, the creators it pays, and a grounded answer.
 */

import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/keryx/site-header";
import { AskForm } from "@/components/keryx/ask-form";
import { ReasoningConsole } from "@/components/keryx/reasoning-console";
import { CreatorsPaidPanel } from "@/components/keryx/creators-paid-panel";
import { AnswerCard } from "@/components/keryx/answer-card";
import { useAskStream } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord } from "@/lib/types";

export default function AskPage() {
  const { state, ask } = useAskStream();
  const streaming = state.status === "streaming";
  const started = state.status !== "idle";

  // Derive creator payouts: prefer streamed settle payments; otherwise fall
  // back to the final run's citations (each citation = a reward to a creator).
  const payouts = useMemo<PaymentRecord[]>(() => {
    if (state.payments.length > 0) return state.payments;
    if (state.run?.citations?.length) {
      return state.run.citations.map((c) => ({
        kind: "citation" as const,
        queryId: state.run!.id,
        sourceId: c.sourceId,
        sourceName: c.sourceName,
        payer: "0xAGENT",
        payee: c.sourceId,
        amountUsdc: c.reward,
        weight: c.weight,
        txHash: null,
        network: "",
        settled: false,
        createdAt: state.run!.createdAt,
      }));
    }
    return [];
  }, [state.payments, state.run]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <Hero compact={started} />

        <div className="mx-auto max-w-3xl">
          <AskForm disabled={streaming} onAsk={ask} />
        </div>

        {state.status === "error" && (
          <div className="mx-auto mt-6 max-w-3xl rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {state.error ?? "Something went wrong."}
          </div>
        )}

        {started && (
          <div className="mt-8 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <ReasoningConsole steps={state.steps} streaming={streaming} />
            <CreatorsPaidPanel
              payments={payouts}
              mode={state.meta?.mode ?? null}
              streaming={streaming}
            />
          </div>
        )}

        {state.run && (
          <div className="mt-6">
            <AnswerCard run={state.run} meta={state.meta} />
          </div>
        )}
      </main>
    </div>
  );
}

function Hero({ compact }: { compact: boolean }) {
  return (
    <section
      className={
        compact
          ? "py-8 text-center sm:py-10"
          : "py-12 text-center sm:py-20"
      }
    >
      <div className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/[0.07] px-3 py-1 text-xs font-medium text-amber-700">
        <Sparkles className="h-3 w-3" />
        Citation-toll reading agent · x402 · USDC on Arc
      </div>
      <h1 className="mx-auto max-w-3xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Every time an AI cites a creator,
        <br className="hidden sm:block" />{" "}
        <span className="bg-gradient-to-r from-amber-600 to-amber-500 bg-clip-text text-transparent">
          the creator gets paid — instantly.
        </span>
      </h1>
      {!compact && (
        <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
          Ask a question with a budget. Keryx autonomously decides which paid
          sources are worth buying, reads enough to answer, and settles a
          weighted nanopayment to every source it cites.
        </p>
      )}
    </section>
  );
}
