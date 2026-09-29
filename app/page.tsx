"use client";

/**
 * Ask / Landing. The question leads the banknote masthead. An SSE stream shows
 * current research and spend, then the cited answer above expandable evidence.
 *
 * Browser co-sign: SessionGrantPanel detects SIWE auth and renders the grant
 * dialog. When a grant is active, sessionId + getSessionWalletClient are passed
 * into useAskStream so sign-requests are auto-signed without MetaMask prompts.
 * Unauthenticated / offline asks fall through to the server-side gateway unchanged.
 */

import { useCallback, useState, useEffect } from "react";
import { buildSourceIndex, type SourceIndex } from "@/lib/payments/client-payto-allowlist";
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
import { ActivityTicker } from "@/components/keryx/activity-ticker";
import { useAskStream } from "@/lib/hooks/use-ask-stream";
import { stepPaymentTotals } from "@/components/keryx/budget-meter";
import { fmtUsdc } from "@/components/keryx/phase-style";

export default function AskPage() {
  // One coarse landing event per tab/day. No stable id is created and credentials are omitted, so
  // the server receives only the allowlisted event name and increments a UTC-day counter.
  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `keryx:activation:landing:${day}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "pending");
      void fetch("/api/activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "reader_landing" }),
        credentials: "omit",
        keepalive: true,
      }).then((response) => {
        if (response.ok) window.sessionStorage.setItem(key, "1");
        else window.sessionStorage.removeItem(key);
      }).catch(() => window.sessionStorage.removeItem(key));
    } catch {
      // Storage disabled or telemetry unavailable: the product remains fully functional.
    }
  }, []);

  // grantBinding drives re-render when the grant activates/revokes so
  // useAskStream's handleEvent picks up the new sessionId via its dep array.
  const [grantBinding, setGrantBinding] = useState<SessionGrantBinding>({
    sessionId: null,
    getSessionWalletClient: () => null,
  });

  // Fetch the public source index once from /api/sources. useAskStream uses it to check
  // every payTo it signs for against that source's on-chain authorised wallets.
  // Stored in state (not a ref) so React can track the value properly during render.
  const [sourceIndex, setSourceIndex] = useState<SourceIndex>(new Map());
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { sources?: Array<{ id?: string; walletAddress?: string; fetchPrice?: number; onchainId?: string }> }) => {
        setSourceIndex(buildSourceIndex(data.sources ?? []));
      })
      .catch((err) => {
        // Non-fatal: without the index, only cap enforcement applies (documented residual).
        console.warn("[keryx] could not fetch the source index for payTo validation:", err);
      });
  }, []);

  const handleBindingChange = useCallback((b: SessionGrantBinding) => {
    setGrantBinding(b);
  }, []);

  const { state, ask } = useAskStream({
    sessionId: grantBinding.sessionId,
    getSessionWalletClient: grantBinding.getSessionWalletClient,
    // pass the cap and source index so the browser enforces them independently.
    grantCap: grantBinding.grantCap,
    sourceIndex,
    // Flip the grant UI to "expired" if the server rejects an ask with 401 session_expired
    // (covers the race where the client still thinks it's active, or a server restart).
    onSessionExpired: grantBinding.markExpired,
  });
  const streaming = state.status === "streaming";
  const started = state.status !== "idle";
  const payer = grantBinding.expired ? "expired" : grantBinding.sessionId ? "session" : "treasury";
  const latestStep = state.steps.at(-1);
  const paymentTotals = stepPaymentTotals(state.steps);
  const unsettled = [
    paymentTotals.pending > 0 ? `$${fmtUsdc(paymentTotals.pending)} pending` : null,
    paymentTotals.simulated > 0 ? `$${fmtUsdc(paymentTotals.simulated)} simulated` : null,
    paymentTotals.unverified > 0 ? `$${fmtUsdc(paymentTotals.unverified)} unverified` : null,
    paymentTotals.failed > 0 ? `$${fmtUsdc(paymentTotals.failed)} failed` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main>
        {!started ? (
          <>
            <section className="mx-auto max-w-[1180px] px-4 pt-2 sm:px-[30px] sm:pt-3" data-tour="hero">
              <div className="border-2 border-ink bg-paper p-1.5">
                <div className="relative overflow-hidden border border-ink p-3 sm:p-4 lg:p-5">
                  <div className="relative grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(260px,2fr)] lg:gap-8">
                    <div className="relative flex min-w-0 flex-col">
                      <p data-testid="hero-kicker" className="hidden font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 sm:flex sm:min-h-11 sm:items-center sm:pr-32">
                        For the writers AI reads · paid per citation
                      </p>
                      <div data-testid="hero-guide" className="order-5 mt-2 self-start sm:absolute sm:right-0 sm:top-0 sm:mt-0">
                        <OnboardingTour />
                      </div>
                      <h1 className="letterpress mt-1 font-display text-[clamp(39px,4vw,54px)] font-medium leading-[0.96] tracking-tight sm:mt-2">
                        Citations are <span className="font-semibold italic text-paid">currency.</span>
                      </h1>
                      <p className="mt-1 max-w-[56ch] font-serif text-[16px] leading-[1.4] text-ink-2 sm:mt-2 sm:text-[18px]">
                        Keryx buys sources, answers with citations, and pays their authors.
                      </p>
                      <div id="dispatch" className="mt-2 scroll-mt-24 sm:mt-3">
                        <AskForm disabled={streaming} onAsk={ask} payer={payer} />
                      </div>
                      <div className="order-6 mt-3">
                        <SessionGrantPanel onBindingChange={handleBindingChange} />
                      </div>
                    </div>
                    <aside className="relative hidden min-w-0 flex-col items-center justify-center gap-4 border-l border-line pl-6 lg:flex" aria-label="Keryx network activity">
                      <div className="relative flex aspect-square w-full max-w-[300px] items-center justify-center">
                        <GlobeWatermark className="absolute inset-0 h-full w-full opacity-35" />
                        <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-paper">
                          <HeraldSeal className="h-28 w-28" />
                        </div>
                      </div>
                      <HeroStats />
                      <a href="/register" className="font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-paid underline underline-offset-4 hover:text-ink">Publish a paid source ↗</a>
                    </aside>
                  </div>
                </div>
              </div>
            </section>
            <div className="mx-auto max-w-[1180px] px-4 pt-3 sm:px-[30px]"><ActivityTicker /></div>

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
            <div id="dispatch" className="max-w-[860px] scroll-mt-24">
              <AskForm disabled={streaming} onAsk={ask} payer={payer} />
              <div className="mt-3"><SessionGrantPanel onBindingChange={handleBindingChange} /></div>
            </div>

            {state.status === "error" &&
              (state.errorKind === "rate-limit" ? (
                <FreeTrialLimitCard message={state.error} retryAfter={state.retryAfter} />
              ) : (
                <div className="mt-5 border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {state.error ?? "Something went wrong."}
                </div>
              ))}

            {state.run && (
              <div className="mt-6" id="answer">
                <AnswerCard
                  run={state.run}
                  meta={state.meta}
                  payments={state.payments}
                  permalink={`${window.location.origin}/dispatch/${state.run.id}`}
                />
              </div>
            )}
            {streaming && !state.run && (
              <div className="mt-6 border border-ink bg-paper px-4 py-4 sm:px-6" role="status" aria-live="polite">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-seal">Research in progress</p>
                <p className="mt-2 font-serif text-[18px] leading-snug text-ink">{latestStep?.message ?? "Finding sources worth reading…"}</p>
                <p className="mt-2 font-mono text-[12px] text-ink-2">{state.steps.length} steps · ${fmtUsdc(paymentTotals.settled)} settled of ${fmtUsdc(state.budget)} budget{unsettled && ` · ${unsettled}`}{state.meta?.mode === "offline" && " · offline simulation"}</p>
              </div>
            )}
            <details className="group mt-5 border border-ink bg-paper" onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer px-4 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-ink marker:text-seal hover:bg-paper-2 sm:px-6">
                Decision log and creator payments · {state.steps.length} steps · ${fmtUsdc(paymentTotals.settled)} settled{unsettled && ` · ${unsettled}`}{state.meta?.mode === "offline" && " · offline simulation"}
              </summary>
              {evidenceOpen && (
                <div className="grid gap-6 border-t border-line p-4 lg:grid-cols-[1.6fr_1fr] sm:p-6">
                  <ReasoningConsole steps={state.steps} streaming={streaming} budget={state.budget} />
                  <CreatorsPaidPanel payments={state.payments} mode={state.meta?.mode ?? null} streaming={streaming} />
                </div>
              )}
            </details>
          </section>
        )}
      </main>
    </div>
  );
}

/**
 * Shown when an anonymous visitor exhausts the free-trial dispatches (treasury path → 429).
 * Not a failure — a warm invitation to either wait out the short reset or connect a wallet
 * and run on their own budget. Styled as a banknote draft to match the dispatch aesthetic.
 */
function FreeTrialLimitCard({
  message,
  retryAfter,
}: {
  message: string | null;
  retryAfter: number | null;
}) {
  return (
    <div className="mt-5 border-2 border-ink bg-paper p-1.5">
      <div className="border border-ink px-5 py-4">
        <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
          <span className="h-[6px] w-[6px] rounded-full bg-seal" />
          Free trial · limit reached
        </div>
        <p className="mt-2.5 max-w-[60ch] font-serif text-[15px] leading-[1.55] text-ink-2">
          {message ??
            "You've used your free dispatches for the moment. Connect a wallet to keep going on your own budget."}
        </p>
        <p className="mt-3 font-mono text-[11px] leading-relaxed tracking-wide text-ink-3">
          {retryAfter && retryAfter > 0
            ? `Connect your wallet (top right) to pay from your own session — or try again in ${retryAfter}s.`
            : "Connect your wallet (top right) to pay from your own session — or try again shortly."}
        </p>
      </div>
    </div>
  );
}
