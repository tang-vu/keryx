"use client";

/**
 * Ask / Landing — the hero. A serif question + budget opens an SSE stream and
 * renders the agent's live dispatch: §I the decision, §II the reading, §III the
 * settlement. Idle, it shows the marketing landing (how it works + creators).
 */

import { useMemo } from "react";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { AskForm } from "@/components/keryx/ask-form";
import { GlobeWatermark } from "@/components/keryx/globe-watermark";
import { ReasoningConsole } from "@/components/keryx/reasoning-console";
import { CreatorsPaidPanel } from "@/components/keryx/creators-paid-panel";
import { AnswerCard } from "@/components/keryx/answer-card";
import { HowItWorks, ForCreators } from "@/components/keryx/landing-sections";
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
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div
            className={
              started
                ? "mx-auto max-w-6xl px-4 pb-6 pt-10 sm:px-8"
                : "mx-auto max-w-6xl px-4 pb-8 pt-16 sm:px-8"
            }
          >
            {!started && (
              <GlobeWatermark className="absolute -right-12 top-2 hidden w-[460px] max-w-[52%] opacity-[0.13] sm:block" />
            )}
            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-3.5 font-mono text-[12px] uppercase tracking-[0.22em] text-ink-3">
                <span className="text-seal">Citation-toll reading agent</span>
                <Dot />
                <span>x402</span>
                <Dot />
                <span>USDC on Arc</span>
              </div>

              <h1 className="mt-6 max-w-[20ch] text-balance font-serif text-[clamp(34px,5.6vw,70px)] font-normal leading-[1.03] tracking-[-0.02em] text-ink">
                Every time an AI <em className="italic">cites</em> a creator, the
                creator gets{" "}
                <em className="italic text-seal underline decoration-seal/40 decoration-[1.5px] underline-offset-4">
                  paid
                </em>{" "}
                — instantly.
              </h1>

              {!started && (
                <p className="mt-6 max-w-[60ch] text-[19px] leading-relaxed text-ink-2">
                  Ask a question with a budget. Keryx autonomously decides which
                  paid sources are worth buying, reads enough to answer, and
                  settles a weighted nanopayment to every source it cites.
                </p>
              )}

              <div className="mt-9 max-w-[780px]">
                <AskForm disabled={streaming} onAsk={ask} />
              </div>
            </div>
          </div>
        </section>

        {state.status === "error" && (
          <div className="mx-auto mb-2 max-w-6xl px-4 sm:px-8">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {state.error ?? "Something went wrong."}
            </div>
          </div>
        )}

        {/* LIVE DISPATCH */}
        {started && (
          <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-8">
            <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
              <ReasoningConsole steps={state.steps} streaming={streaming} />
              <CreatorsPaidPanel
                payments={payouts}
                mode={state.meta?.mode ?? null}
                streaming={streaming}
              />
            </div>
            {state.run && (
              <div className="mt-5">
                <AnswerCard run={state.run} meta={state.meta} />
              </div>
            )}
          </section>
        )}

        {/* LANDING */}
        {!started && (
          <>
            <HowItWorks />
            <ForCreators />
            <SiteFooter />
          </>
        )}
      </main>
    </div>
  );
}

function Dot() {
  return (
    <span className="h-[5px] w-[5px] rounded-full bg-line" aria-hidden />
  );
}
