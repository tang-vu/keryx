"use client";

import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buildSourceIndex, type SourceIndex } from "@/lib/payments/client-payto-allowlist";
import { useAskStream } from "@/lib/hooks/use-ask-stream";
import { AskForm } from "./ask-form";
import { OnboardingTour } from "./onboarding-tour";
import { SessionGrantPanel, type SessionGrantBinding } from "./session-grant-panel";
import { ResearchTurn, type ResearchTurnData } from "./research-turn";
import { GlobeWatermark } from "./globe-watermark";
import { SponsoredTrialNotice } from "./sponsored-trial-notice";
import { createPrivateClaimHandoff, type PrivateClaimStatus } from "@/lib/run-claims/web-handoff";
import { readPrivateDocument } from "@/lib/run-claims/web-bootstrap";
import { privateResearchCopy } from "@/locales/en/run-claim-research";
import { productGuideCopy } from "@/locales/en/product-guide";

export function ResearchChat({ paidHref = "/research#paid-research", showLaunchBadge = false, privateClaims = false, introduceProduct = false }: { paidHref?: string; showLaunchBadge?: boolean; privateClaims?: boolean; introduceProduct?: boolean }) {
  const [privateHandoff] = useState(() => createPrivateClaimHandoff({ origin: () => window.location.origin,
    documentProof: readPrivateDocument, open: url => { window.open(url, "_blank", "noopener,noreferrer"); } }));
  const [claimStatus, setClaimStatus] = useState<PrivateClaimStatus>("none");
  const protectedDocument = useSyncExternalStore(useCallback(listener => {
    if (!privateClaims) return () => {};
    window.addEventListener("pagehide", listener);
    return () => window.removeEventListener("pagehide", listener);
  }, [privateClaims]), () => privateClaims && !!readPrivateDocument(), () => false);
  useEffect(() => {
    if (!privateClaims) return;
    const unsubscribe = privateHandoff.subscribe(setClaimStatus);
    const forget = () => privateHandoff.clear();
    window.addEventListener("pagehide", forget);
    return () => { unsubscribe(); window.removeEventListener("pagehide", forget); forget(); };
  }, [privateClaims, privateHandoff]);
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
    ...(privateClaims ? { privateClaimHandoff: privateHandoff } : {}),
  });
  const streaming = state.status === "streaming";
  const payer = grantBinding.paused ? "paused" : grantBinding.expired ? "expired" : grantBinding.sessionId ? "session" : "treasury";
  const parentId = rootRequest ? null : state.run?.id ?? anchor;
  const submit: Parameters<typeof AskForm>[0]["onAsk"] = (question, budget, sharedParent, model, mode, scholarly, paidScholarly, reviewFirst) => {
    if (streaming) return;
    if (request) setHistory(previous => [...previous, { ...request, state }]);
    setAnchor(rootRequest ? undefined : parentId ?? undefined);
    setRequest({ id: ++sequence.current, question, payer: payer === "session" ? message("researchChat.sessionPayer") : payer === "expired" ? message("researchChat.expiredPayer") : message("researchChat.treasuryPayer") });
    setRootRequest(false);
    void ask(question, budget, rootRequest ? undefined : parentId ?? sharedParent, model, mode, scholarly, paidScholarly, reviewFirst);
  };
  const stop = () => {
    if (!request || !streaming) return;
    setHistory(previous => [...previous, { ...request, state, stopped: true }]);
    setRequest(null);
    reset();
  };
  const hasTurns = history.length > 0 || request !== null;
  return <section className="mx-auto max-w-[960px] px-4 pb-8 pt-2 sm:px-[30px] sm:pt-6" data-tour="hero" aria-label={message("researchChat.label")}>
    <header className="relative mb-2 min-h-[100px] sm:mb-4 sm:min-h-[140px]">
      <div aria-hidden="true" data-testid="chat-globe" className="pointer-events-none absolute right-0 top-[44px] h-[56px] w-[56px] opacity-60 sm:top-0 sm:h-[140px] sm:w-[140px]">
        <GlobeWatermark className="h-[140px] w-[140px] origin-top-left scale-[0.4] sm:scale-100" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="hero-kicker" className={`${introduceProduct ? "max-w-[calc(100%_-_140px)] sm:max-w-none " : ""}font-mono text-[11px] uppercase tracking-wide text-seal`}>{introduceProduct ? productGuideCopy("product.heroKicker") : message("researchChat.kicker")}</p>
        <div data-testid="hero-guide" className="absolute right-0 top-0 sm:static sm:mr-[156px]"><OnboardingTour /></div>
      </div>
      <h1 className={`mt-1 font-display ${introduceProduct ? "text-[clamp(28px,5vw,46px)]" : "text-[clamp(32px,5vw,46px)]"} leading-none sm:mt-2 sm:leading-tight`}>{introduceProduct ? productGuideCopy("product.heroTitle") : message("researchChat.title")}</h1>
      <p className="mt-1 max-w-[calc(100%_-_84px)] font-serif text-sm leading-5 text-ink-2 sm:mt-2 sm:max-w-[64ch] sm:text-base sm:leading-normal">{introduceProduct ? productGuideCopy("product.heroBody") : message("researchChat.introduction")}</p>
    </header>
    {hasTurns && <div className="space-y-8 py-4" aria-label={message("researchChat.turnsLabel")}>
      {history.map(turn => <ResearchTurn key={turn.id} turn={turn} />)}
      {request && <div ref={activeTurnRef} className="scroll-mt-24"><ResearchTurn key={request.id} turn={{ ...request, state }} /></div>}
    </div>}
    <div id="dispatch" className="scroll-mt-24">
      {hasTurns && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[64ch] text-xs text-ink-3">{parentId ? message("researchChat.followUpContext") : message("researchChat.newQuestionContext")}</p>
        {!streaming && parentId && <button type="button" onClick={() => { setRootRequest(true); setAnchor(undefined); }} className="min-h-11 px-2 font-mono text-xs underline underline-offset-4">{message("researchChat.newResearch")}</button>}
        {streaming && <button type="button" onClick={stop} className="min-h-11 border border-seal px-3 py-2 font-mono text-xs text-seal">{message("researchChat.stopResearch")}</button>}
      </div>}
      {privateClaims && !protectedDocument && <p role="status" className="mt-3 text-seal">{privateResearchCopy.fullNavigation}</p>}
      <AskForm disabled={streaming || privateClaims && !protectedDocument} onAsk={submit} payer={payer} questionCapUsdc={grantBinding.questionCapUsdc} parentId={hasTurns ? parentId ?? null : undefined} conversation={hasTurns} clearOnSubmit
        showLaunchBadge={showLaunchBadge && !hasTurns}
        restoreQuestion={request && (state.errorKind === "research-paused" || state.errorKind === "rate-limit" || state.errorKind === "maintenance")
          ? { ...request, researchPaused: state.errorKind === "research-paused" } : undefined} />
      {payer === "treasury" && !hasTurns && <div className="mt-3"><SponsoredTrialNotice /></div>}
      {!privateClaims && <div className="mt-3"><SessionGrantPanel onBindingChange={handleBindingChange} /></div>}
      {privateClaims && claimStatus !== "none" && claimStatus !== "waiting" && <div className="mt-3 border border-line p-4" role="status">
        <p>{claimStatus === "available" ? privateResearchCopy.available : claimStatus === "opened" ? privateResearchCopy.opened : claimStatus === "lost" ? privateResearchCopy.lost : privateResearchCopy.failed}</p>
        {claimStatus === "available" && <button className="mt-2 min-h-11 underline" type="button" onClick={() => privateHandoff.open()}>{privateResearchCopy.open}</button>}
      </div>}
      <p className="mt-3 text-xs text-ink-3">{message("researchChat.historyNotice")}</p>
      <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-ink-2" aria-label={message("researchChat.toolsLabel")}>
        {!privateClaims && <a href="/research/private" className="underline underline-offset-4">{privateResearchCopy.entry}</a>}
        <a href="/me/asks" className="underline underline-offset-4">{message("researchChat.savedReports")}</a>
        <a href={paidHref} className="underline underline-offset-4">{message("researchChat.paidResearch")}</a>
        <a href="/register" className="underline underline-offset-4">{message("researchChat.publishSource")}</a>
      </nav>
    </div>
  </section>;
}
