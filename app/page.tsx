"use client";

/**
 * Ask / Landing — the hero. A Bodoni dispatch order + budget opens an SSE
 * stream and renders the live dispatch: §I the decision, §II the reading, §III
 * the settlement. Idle, it shows the herald seal, traction, and the landing.
 */

import { useMemo } from "react";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { AskForm } from "@/components/keryx/ask-form";
import { GlobeWatermark } from "@/components/keryx/globe-watermark";
import { HeraldSeal } from "@/components/keryx/herald-seal";
import { HeroStats } from "@/components/keryx/hero-stats";
import { Microprint } from "@/components/keryx/banknote";
import { ReasoningConsole } from "@/components/keryx/reasoning-console";
import { CreatorsPaidPanel } from "@/components/keryx/creators-paid-panel";
import { AnswerCard } from "@/components/keryx/answer-card";
import { HowItWorks, ForCreators } from "@/components/keryx/landing-sections";
import { useAskStream } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord } from "@/lib/types";

const MICROPRINT =
  "THE HERALD IS PAID · ΚΗΡΥΞ · A CITATION IS A PAYMENT EVENT · USDC ON ARC · WEIGHTED BY CONTRIBUTION";

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
        <section className="relative overflow-hidden border-b border-line">
          <div
            className={
              started
                ? "mx-auto max-w-6xl px-4 pb-6 pt-9 sm:px-8"
                : "mx-auto max-w-6xl px-4 pb-9 pt-14 sm:px-8"
            }
          >
            <div className="grid items-center gap-10 lg:grid-cols-[1.12fr_0.88fr]">
              <div className="relative z-10">
                <div className="flex flex-wrap items-center gap-3.5 font-mono text-[12px] uppercase tracking-[0.22em] text-ink-3">
                  <span className="text-seal">Citation-toll reading agent</span>
                  <Dot />
                  <span>x402</span>
                  <Dot />
                  <span>USDC on Arc</span>
                </div>

                <h1 className="letterpress mt-6 max-w-[20ch] text-balance font-display text-[clamp(36px,5.4vw,68px)] font-medium leading-[1.02] tracking-[-0.015em] text-ink">
                  Every time an AI <em className="font-semibold italic">cites</em> a
                  creator, the creator gets{" "}
                  <em className="font-semibold italic text-seal">paid</em> —
                  instantly.
                </h1>

                {!started && (
                  <>
                    <p className="mt-6 max-w-[54ch] font-serif text-[19px] leading-[1.55] text-ink-2">
                      Ask a question with a budget. Keryx autonomously decides
                      which paid sources are worth buying, reads enough to
                      answer, and settles a weighted nanopayment to every source
                      it cites.
                    </p>
                    <HeroStats />
                  </>
                )}

                <div className="mt-8 max-w-[760px]">
                  <AskForm disabled={streaming} onAsk={ask} />
                </div>
              </div>

              {!started && (
                <div className="relative hidden min-h-[360px] items-center justify-center lg:flex">
                  <GlobeWatermark className="absolute inset-0 m-auto w-[400px] opacity-[0.16]" />
                  <HeraldSeal className="relative z-10 w-[240px] opacity-90" />
                </div>
              )}
            </div>

            <Microprint text={MICROPRINT} className="mt-10" />
          </div>
        </section>

        {state.status === "error" && (
          <div className="mx-auto mt-4 max-w-6xl px-4 sm:px-8">
            <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {state.error ?? "Something went wrong."}
            </div>
          </div>
        )}

        {/* LIVE DISPATCH */}
        {started && (
          <section className="mx-auto max-w-6xl px-4 pb-16 pt-9 sm:px-8">
            <h2 className="mb-7 border-b border-ink pb-3.5 font-display text-[clamp(24px,3.2vw,34px)] font-medium tracking-tight text-ink">
              The dispatch, <em className="italic text-paid">itemised.</em>
            </h2>
            <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
              <ReasoningConsole steps={state.steps} streaming={streaming} />
              <CreatorsPaidPanel
                payments={payouts}
                mode={state.meta?.mode ?? null}
                streaming={streaming}
              />
            </div>
            {state.run && (
              <div className="mt-6">
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
  return <span className="h-[5px] w-[5px] rounded-full bg-line" aria-hidden />;
}
