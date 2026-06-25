"use client";

/**
 * Ask / Landing — the banknote masthead ("Citations are currency.") with the
 * herald seal, real-traction denomination box, and a guilloché divider. The
 * dispatch order opens an SSE stream and renders the live dispatch: §I the
 * decision, §II the reading, §III the settlement.
 *
 * Browser co-sign: SessionGrantPanel detects SIWE auth and renders the grant
 * dialog. When a grant is active, sessionId + getSessionWalletClient are passed
 * into useAskStream so sign-requests are auto-signed without MetaMask prompts.
 * Unauthenticated / offline asks fall through to the server-side gateway unchanged.
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import { SiteHeader } from "@/components/keryx/site-header";
import { SiteFooter } from "@/components/keryx/site-footer";
import { AskForm } from "@/components/keryx/ask-form";
import { GlobeWatermark } from "@/components/keryx/globe-watermark";
import { HeraldSeal } from "@/components/keryx/herald-seal";
import { HeroStats } from "@/components/keryx/hero-stats";
import { ReasoningConsole } from "@/components/keryx/reasoning-console";
import { CreatorsPaidPanel } from "@/components/keryx/creators-paid-panel";
import { AnswerCard } from "@/components/keryx/answer-card";
import { HowItWorks, ForCreators } from "@/components/keryx/landing-sections";
import { SessionGrantPanel } from "@/components/keryx/session-grant-panel";
import type { SessionGrantBinding } from "@/components/keryx/session-grant-panel";
import { OnboardingTour } from "@/components/keryx/onboarding-tour";
import { useAskStream } from "@/lib/hooks/use-ask-stream";
import type { PaymentRecord } from "@/lib/types";

export default function AskPage() {
  // grantBinding drives re-render when the grant activates/revokes so
  // useAskStream's handleEvent picks up the new sessionId via its dep array.
  const [grantBinding, setGrantBinding] = useState<SessionGrantBinding>({
    sessionId: null,
    getSessionWalletClient: () => null,
  });

  // Fetch known source wallets once from /api/sources (public endpoint).
  // Used by useAskStream to validate fetch-toll payTo addresses client-side.
  // Stored in state (not a ref) so React can track the value properly during render.
  const [knownSourceWallets, setKnownSourceWallets] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { sources?: Array<{ walletAddress?: string }> }) => {
        const wallets = new Set<string>();
        for (const s of data.sources ?? []) {
          if (s.walletAddress) wallets.add(s.walletAddress.toLowerCase());
        }
        setKnownSourceWallets(wallets);
      })
      .catch((err) => {
        // Non-fatal: without a wallet list, only cap enforcement applies (documented residual).
        console.warn("[keryx] could not fetch source wallets for payTo validation:", err);
      });
  }, []);

  const handleBindingChange = useCallback((b: SessionGrantBinding) => {
    setGrantBinding(b);
  }, []);

  const { state, ask } = useAskStream({
    sessionId: grantBinding.sessionId,
    getSessionWalletClient: grantBinding.getSessionWalletClient,
    // pass the cap and known wallets so the browser enforces them independently.
    grantCap: grantBinding.grantCap,
    knownSourceWallets,
    // Flip the grant UI to "expired" if the server rejects an ask with 401 session_expired
    // (covers the race where the client still thinks it's active, or a server restart).
    onSessionExpired: grantBinding.markExpired,
  });
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
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <OnboardingTour />
      <main>
        {!started ? (
          <>
            {/* HERO NOTE */}
            <section className="mx-auto max-w-[1180px] px-4 pb-2 pt-12 sm:px-[30px]" data-tour="hero">
              <div className="border-2 border-ink bg-paper p-1.5">
                <div className="relative overflow-hidden border border-ink p-[clamp(28px,4.5vw,56px)]">
                  <div className="pointer-events-none absolute right-[-90px] top-1/2 hidden h-[560px] w-[560px] -translate-y-1/2 opacity-50 lg:block">
                    <GlobeWatermark className="h-full w-full" />
                  </div>

                  <div className="relative flex items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
                    <span>For the writers AI reads &nbsp;·&nbsp; paid per citation</span>
                    <span className="text-ink">Series 2026 — No. 00481</span>
                  </div>

                  <h1 className="letterpress relative mt-6 font-display text-[clamp(46px,8.2vw,116px)] font-medium leading-[0.92] tracking-[-0.01em]">
                    Citations are
                    <br />
                    <span className="font-semibold italic text-paid">currency.</span>
                  </h1>

                  <div className="relative mt-9 grid items-end gap-[clamp(28px,4vw,56px)] md:grid-cols-[1.45fr_0.9fr]">
                    <div>
                      <p className="max-w-[46ch] font-serif text-[clamp(17px,1.5vw,20px)] leading-[1.55] text-ink-2">
                        Keryx is a reading agent with a purse. Give it a question
                        and a budget — it buys the sources worth reading, answers
                        with citations, and pays every author it quotes, in the
                        same breath.
                      </p>
                      <div className="mt-7 flex flex-wrap gap-3">
                        <a
                          href="#dispatch"
                          className="border border-ink bg-ink px-6 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--seal)] active:translate-y-0 active:shadow-none"
                        >
                          Ask the herald ▸
                        </a>
                        <a
                          href="/register"
                          className="border border-ink px-6 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors hover:bg-ink hover:text-paper"
                        >
                          Issue a toll
                        </a>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-6">
                      <HeraldSeal className="h-32 w-32" />
                      <HeroStats />
                    </div>
                  </div>

                  {/* guilloché divider + microprint */}
                  <div className="relative mt-9">
                    <svg
                      viewBox="0 0 1200 40"
                      preserveAspectRatio="none"
                      className="block h-3.5 w-full"
                    >
                      <use href="#eng-waveA" fill="none" stroke="var(--ink)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.55" />
                      <use href="#eng-waveB" fill="none" stroke="var(--paid)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.55" />
                    </svg>
                    <div className="mt-2 overflow-hidden whitespace-nowrap font-mono text-[8.5px] uppercase tracking-[0.42em] text-faint">
                      {"keryx · the one sent to carry a message and paid for the carrying · ".repeat(
                        6,
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* DISPATCH ORDER */}
            <section id="dispatch" className="mx-auto max-w-[1180px] px-4 pt-9 sm:px-[30px]">
              {/* Non-custodial session grant — shown only when SIWE-authed */}
              <SessionGrantPanel onBindingChange={handleBindingChange} />
              <AskForm disabled={streaming} onAsk={ask} />
              <PayerNote active={!!grantBinding.sessionId && !grantBinding.expired} expired={!!grantBinding.expired} />
            </section>

            <HowItWorks />
            <ForCreators />
            <SiteFooter />
          </>
        ) : (
          /* THE READING ROOM — live dispatch */
          <section className="mx-auto max-w-[1180px] px-4 pb-20 pt-10 sm:px-[30px]">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
              The reading room
            </div>
            <div id="dispatch" className="max-w-[860px]">
              {/* Session grant panel persists across queries — grant stays active */}
              <SessionGrantPanel onBindingChange={handleBindingChange} />
              <AskForm disabled={streaming} onAsk={ask} />
              <PayerNote active={!!grantBinding.sessionId && !grantBinding.expired} expired={!!grantBinding.expired} />
            </div>

            {state.status === "error" && (
              <div className="mt-5 border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {state.error ?? "Something went wrong."}
              </div>
            )}

            <h2 className="mb-7 mt-10 border-b border-ink pb-3.5 font-display text-[clamp(24px,3.2vw,34px)] font-medium tracking-tight text-ink">
              The dispatch, <em className="italic text-paid">itemised.</em>
            </h2>
            <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
              <ReasoningConsole steps={state.steps} streaming={streaming} budget={state.budget} />
              <CreatorsPaidPanel
                payments={payouts}
                mode={state.meta?.mode ?? null}
                streaming={streaming}
              />
            </div>
            {state.run && (
              <div className="mt-6">
                <AnswerCard
                  run={state.run}
                  meta={state.meta}
                  permalink={`${window.location.origin}/dispatch/${state.run.id}`}
                />
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

/**
 * Who pays for this run. Without an active session grant the agent settles from
 * Keryx's own treasury wallet (so asks work with no wallet — handy for demos);
 * with a grant it settles from the user's funded session. Surfaced so it's never
 * a mystery whose USDC is being spent.
 */
function PayerNote({ active, expired }: { active: boolean; expired?: boolean }) {
  const dot = active ? "bg-paid" : expired ? "bg-destructive" : "bg-seal";
  return (
    <p className="mt-2.5 flex items-center gap-2 font-mono text-[10px] leading-relaxed tracking-wide text-ink-3">
      <span className={`h-[6px] w-[6px] rounded-full ${dot}`} />
      {active
        ? "Settling from your funded session — your wallet pays, capped at the funded amount."
        : expired
          ? "Session expired — recover it above to pay from your wallet (this run won't proceed until you do)."
          : "This run is settled by Keryx's treasury. Activate a session above to pay from your own wallet."}
    </p>
  );
}
