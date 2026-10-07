"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildSourceIndex, type SourceIndex } from "@/lib/payments/client-payto-allowlist";
import { useAskStream } from "@/lib/hooks/use-ask-stream";
import { AskForm } from "./ask-form";
import { OnboardingTour } from "./onboarding-tour";
import { SessionGrantPanel, type SessionGrantBinding } from "./session-grant-panel";
import { ResearchTurn, type ResearchTurnData } from "./research-turn";
import { GlobeWatermark } from "./globe-watermark";
import { SponsoredTrialNotice } from "./sponsored-trial-notice";

export function ResearchChat({ paidHref = "/research#paid-research" }: { paidHref?: string }) {
  const [grantBinding, setGrantBinding] = useState<SessionGrantBinding>({ sessionId: null, getSessionWalletClient: () => null });
  const [sourceIndex, setSourceIndex] = useState<SourceIndex>(new Map());
  const [history, setHistory] = useState<ResearchTurnData[]>([]);
  const [request, setRequest] = useState<Omit<ResearchTurnData, "state"> | null>(null);
  const [rootRequest, setRootRequest] = useState(false);
  const [anchor, setAnchor] = useState<string | undefined>();
  const sequence = useRef(0);
  const activeTurnRef = useRef<HTMLDivElement>(null);
  const requestId = request?.id;
  useEffect(() => {
    // Scroll once, after the submitted turn exists in the committed DOM.
    // Streamed steps and readers inspecting older reports never trigger it.
    if (requestId !== undefined) activeTurnRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [requestId]);
  useEffect(() => {
    fetch("/api/sources").then(response => response.ok ? response.json() : Promise.reject(new Error("Source authority unavailable")))
      .then((data: { sources?: Array<{ id?: string; walletAddress?: string; fetchPrice?: number; onchainId?: string }> }) => setSourceIndex(buildSourceIndex(data.sources ?? [])))
      .catch(() => { /* Empty index refuses browser payment signing. */ });
  }, []);
  const handleBindingChange = useCallback((binding: SessionGrantBinding) => setGrantBinding(binding), []);
  const { state, ask, reset } = useAskStream({
    sessionId: grantBinding.sessionId,
    getSessionWalletClient: grantBinding.getSessionWalletClient,
    authorizeSessionPayment: grantBinding.authorizeSessionPayment,
    grantCap: grantBinding.grantCap,
    questionCapUsdc: grantBinding.questionCapUsdc,
    sourceIndex,
    onSessionExpired: grantBinding.markExpired,
  });
  const streaming = state.status === "streaming";
  const payer = grantBinding.paused ? "paused" : grantBinding.expired ? "expired" : grantBinding.sessionId ? "session" : "treasury";
  const parentId = rootRequest ? null : state.run?.id ?? anchor;
  const submit: Parameters<typeof AskForm>[0]["onAsk"] = (question, budget, sharedParent, model, mode, scholarly, paidScholarly) => {
    if (streaming) return;
    if (request) setHistory(previous => [...previous, { ...request, state }]);
    setAnchor(rootRequest ? undefined : parentId ?? undefined);
    setRequest({ id: ++sequence.current, question, payer: payer === "session" ? "your funded session" : payer === "expired" ? "your expired funded session (recovery required)" : "Keryx treasury" });
    setRootRequest(false);
    void ask(question, budget, rootRequest ? undefined : parentId ?? sharedParent, model, mode, scholarly, paidScholarly);
  };
  const stop = () => {
    if (!request || !streaming) return;
    setHistory(previous => [...previous, { ...request, state, stopped: true }]);
    setRequest(null);
    reset();
  };
  const hasTurns = history.length > 0 || request !== null;
  return <section className="mx-auto max-w-[960px] px-4 pb-8 pt-4 sm:px-[30px] sm:pt-6" data-tour="hero" aria-label="Research conversation">
    <header className="relative mb-4 sm:min-h-[140px]">
      <div aria-hidden="true" data-testid="chat-globe" className="pointer-events-none absolute right-0 top-[52px] h-[70px] w-[70px] opacity-60 sm:top-0 sm:h-[140px] sm:w-[140px]">
        <GlobeWatermark className="h-[140px] w-[140px] origin-top-left scale-50 sm:scale-100" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="hero-kicker" className="font-mono text-[11px] uppercase tracking-wide text-seal">Research with Keryx</p>
        <div data-testid="hero-guide" className="sm:mr-[156px]"><OnboardingTour /></div>
      </div>
      <h1 className="mt-2 font-display text-[clamp(32px,5vw,46px)] leading-tight">Ask Keryx</h1>
      <p className="mt-2 max-w-[calc(100%_-_84px)] font-serif text-base text-ink-2 sm:max-w-[64ch]">Ask a research question, inspect cited evidence, and see which sources were bought, skipped or reused.</p>
    </header>
    {hasTurns && <div className="space-y-8 py-4" aria-label="Conversation turns">
      {history.map(turn => <ResearchTurn key={turn.id} turn={turn} />)}
      {request && <div ref={activeTurnRef} className="scroll-mt-24"><ResearchTurn key={request.id} turn={{ ...request, state }} /></div>}
    </div>}
    <div id="dispatch" className="scroll-mt-24">
      {hasTurns && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[64ch] text-xs text-ink-3">{parentId ? "Follow-ups use the previous question only, not its answer or the full chat. Include the details you want researched." : "Start a new research question. Each request has its own source cap."}</p>
        {!streaming && parentId && <button type="button" onClick={() => { setRootRequest(true); setAnchor(undefined); }} className="min-h-11 px-2 font-mono text-xs underline underline-offset-4">New research</button>}
        {streaming && <button type="button" onClick={stop} className="min-h-11 border border-seal px-3 py-2 font-mono text-xs text-seal">Stop research</button>}
      </div>}
      <AskForm disabled={streaming} onAsk={submit} payer={payer} questionCapUsdc={grantBinding.questionCapUsdc} parentId={hasTurns ? parentId ?? null : undefined} conversation={hasTurns} clearOnSubmit
        restoreQuestion={request && (state.errorKind === "research-paused" || state.errorKind === "rate-limit")
          ? { ...request, researchPaused: state.errorKind === "research-paused" } : undefined} />
      {payer === "treasury" && !hasTurns && <div className="mt-3"><SponsoredTrialNotice /></div>}
      <div className="mt-3"><SessionGrantPanel onBindingChange={handleBindingChange} /></div>
      <p className="mt-3 text-xs text-ink-3">Conversation stays in this tab while the page is open. Completed reports have a saved link; signed-in reports appear in My saved reports. Download a report to keep a local copy.</p>
      <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-ink-2" aria-label="Research tools">
        <a href="/me/asks" className="underline underline-offset-4">My saved reports</a>
        <a href={paidHref} className="underline underline-offset-4">Paid agent research & recovery</a>
        <a href="/register" className="underline underline-offset-4">Publish a paid source</a>
      </nav>
    </div>
  </section>;
}
