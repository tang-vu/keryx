"use client";





import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { useResearchVisibility, type ResearchPublicationSelection } from "@/lib/hooks/use-research-visibility";
import type { AskStreamState } from "@/lib/hooks/use-ask-stream";
import { UiText, UiMessage, useUiCopy, useUiMessages } from "@/lib/i18n/ui-copy";
import type { RunVisibility } from "@/lib/run-privacy/contracts";
import { researchRecoveryCopy } from "@/lib/research/research-recovery-copy";
const uiEnglish_privateResearchCopy = privateResearchCopy;
const uiEnglish_productGuideCopy = productGuideCopy;


type ScopedTurn = ResearchTurnData & { publication: ResearchPublicationSelection; ownerRevision: number };
type ScopedRequest = Omit<ScopedTurn, "state">;
const hidden = (turn: ScopedRequest, state: AskStreamState) => turn.publication.visibility !== "public" || !!state.meta?.visibility && state.meta.visibility !== "public";

export function ResearchChat({ paidHref = "/research#paid-research", privateClaims = false, introduceProduct = false, initialRequest }: {
  paidHref?: string; privateClaims?: boolean; introduceProduct?: boolean;
  initialRequest?: { question: string; budget: number; parentId: string; visibility: RunVisibility; expectedWallet: string | null };
}) {
  const message = useUiMessages();
  const privateResearchCopy = useUiCopy("run-claim-research", uiEnglish_privateResearchCopy);
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
  const [history, setHistory] = useState<ScopedTurn[]>([]);
  const [request, setRequest] = useState<ScopedRequest | null>(null);
  const [rootRequest, setRootRequest] = useState(false);
  const [anchor, setAnchor] = useState<string | undefined>(initialRequest?.parentId);
  const [reopened, setReopened] = useState<{ id: number; question: string; budget: number; researchPaused: false; replace: true;
    binding?: { wallet: string | null; revision: number } } | undefined>(
    initialRequest ? { id: 0, question: initialRequest.question, budget: initialRequest.budget, researchPaused: false, replace: true } : undefined);
  const recoverySequence = useRef(0);
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
  const activeRequest = useRef<ScopedRequest | null>(null), activeState = useRef(state);
  useLayoutEffect(() => { activeRequest.current = request; activeState.current = state; }, [request, state]);
  const clearOwnedTurns = useCallback(() => {
    setReopened(undefined);
    setHistory(previous => previous.filter(turn => !hidden(turn, turn.state)));
    if (activeRequest.current && hidden(activeRequest.current, activeState.current)) {
      activeRequest.current = null; setRequest(null); reset();
    }
    setAnchor(undefined); setRootRequest(true); privateHandoff.clear();
  }, [reset, privateHandoff]);
  const inheritedTurn = history.find(turn => turn.state.run?.id === parentId);
  const parentVisibility = parentId ? state.meta?.visibility ?? request?.publication.visibility
    ?? inheritedTurn?.state.meta?.visibility ?? inheritedTurn?.publication.visibility
    ?? (parentId === initialRequest?.parentId ? initialRequest?.visibility : undefined) : undefined;
  const publicationPreference = useResearchVisibility(parentVisibility, { onOwnerBoundary: clearOwnedTurns });
  useEffect(() => () => reset(), [reset]);
  useEffect(() => {
    if (request && state.meta?.visibility === "private" && (!state.meta.visibilityOwner
      || state.meta.visibilityOwner.toLowerCase() !== request.publication.expectedWallet)) clearOwnedTurns();
  }, [request, state.meta, clearOwnedTurns]);
  const canDisplay = (turn: ScopedRequest, captured: AskStreamState) => !hidden(turn, captured)
    || publicationPreference.ready && turn.ownerRevision === publicationPreference.identityRevision
      && turn.publication.expectedWallet === publicationPreference.wallet
      && (captured.meta?.visibility !== "private" || !!captured.meta.visibilityOwner
        && captured.meta.visibilityOwner.toLowerCase() === publicationPreference.wallet);
  const visibleHistory = history.filter(turn => canDisplay(turn, turn.state));
  const visibleRequest = request && canDisplay(request, state) ? request : null;
  const recoverySelection = reopened && publicationPreference.ready
    && (!reopened.binding || reopened.binding.wallet === publicationPreference.wallet
      && reopened.binding.revision === publicationPreference.identityRevision)
    && (!initialRequest || initialRequest.visibility === "public" || initialRequest.expectedWallet === publicationPreference.wallet)
    ? reopened : undefined;
  const submit: Parameters<typeof AskForm>[0]["onAsk"] = (question, budget, sharedParent, model, mode, scholarly, paidScholarly, reviewFirst, publication) => {
    if (streaming) return;
    const selected = publicationPreference.getSelection();
    if (!selected || !publication || selected.expectedWallet !== publication.expectedWallet || selected.visibility !== publication.visibility) return;
    setReopened(undefined);
    if (request) setHistory(previous => [...previous, { ...request, state }]);
    setAnchor(rootRequest ? undefined : parentId ?? undefined);
    const next = { id: ++sequence.current, question, publication: selected, ownerRevision: publicationPreference.getIdentityRevision(),
      payer: payer === "session" ? message("researchChat.sessionPayer") : payer === "expired" ? message("researchChat.expiredPayer") : message("researchChat.treasuryPayer") };
    activeRequest.current = next; setRequest(next);
    setRootRequest(false);
    void ask(question, budget, rootRequest ? undefined : parentId ?? sharedParent, model, mode, scholarly, paidScholarly, reviewFirst, publication);
  };
  const stop = () => {
    if (!request || !streaming) return;
    setHistory(previous => [...previous, { ...request, state, stopped: true }]);
    setRequest(null);
    reset();
  };
  const hasTurns = visibleHistory.length > 0 || visibleRequest !== null;
  return <section className="mx-auto max-w-[960px] px-4 pb-8 pt-2 sm:px-[30px] sm:pt-6" data-research-intro={introduceProduct ? "" : undefined} aria-label={message("researchChat.label")}>
    <header className="kx-research-hero relative mb-3 min-h-[116px] border-b border-line pb-3 sm:mb-6 sm:min-h-[168px] sm:pb-6" data-tour="hero">
      <div aria-hidden="true" data-testid="chat-globe" className="pointer-events-none absolute right-0 top-[44px] h-[56px] w-[56px] opacity-60 sm:top-0 sm:h-[140px] sm:w-[140px]">
        <GlobeWatermark className="h-[140px] w-[140px] origin-top-left scale-[0.4] sm:scale-100" />
      </div>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <p data-testid="hero-kicker" className="kx-research-kicker min-w-0 font-mono text-[11px] uppercase tracking-[0.14em] text-seal [overflow-wrap:anywhere]">{introduceProduct ? <UiText source={uiEnglish_productGuideCopy("product.heroKicker")} namespaces={["product-guide"]} /> : <UiMessage messageKey="researchChat.kicker" />}</p>
        <div data-testid="hero-guide" className="relative z-10 min-w-0 max-w-full sm:mr-[156px]"><OnboardingTour /></div>
      </div>
      <h1 className={`kx-research-title mt-3 max-w-[calc(100%_-_84px)] font-display ${introduceProduct ? "text-[clamp(30px,9vw,64px)] tracking-[-0.035em]" : "text-[clamp(32px,5vw,46px)]"} leading-none sm:max-w-[calc(100%_-_156px)] sm:leading-tight`}>{introduceProduct ? <UiText source={uiEnglish_productGuideCopy("product.heroTitle")} namespaces={["product-guide"]} /> : <UiMessage messageKey="researchChat.title" />}</h1>
      <p className="kx-research-intro mt-3 max-w-[calc(100%_-_84px)] font-serif text-sm leading-5 text-ink-2 sm:max-w-[min(60ch,calc(100%_-_156px))] sm:text-lg sm:leading-relaxed">{introduceProduct && payer === "treasury" ? <UiText source={uiEnglish_productGuideCopy("product.heroBody")} namespaces={["product-guide"]} /> : <UiMessage messageKey="researchChat.introduction" />}</p>
    </header>
    {hasTurns && <div className="space-y-8 py-4" aria-label={message("researchChat.turnsLabel")}>
      {visibleHistory.map(turn => <ResearchTurn key={turn.id} turn={turn} />)}
      {visibleRequest && <div ref={activeTurnRef} className="scroll-mt-24"><ResearchTurn key={visibleRequest.id} turn={{ ...visibleRequest, state }} /></div>}
    </div>}
    <div id="dispatch" className="scroll-mt-24">
      {hasTurns && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[64ch] text-xs text-ink-3">{parentId ? message("researchChat.followUpContext") : message("researchChat.newQuestionContext")}</p>
        {!streaming && parentId && <button type="button" onClick={() => { setRootRequest(true); setAnchor(undefined); }} className="min-h-11 px-2 font-mono text-xs underline underline-offset-4">{message("researchChat.newResearch")}</button>}
        {streaming && <button type="button" onClick={stop} className="min-h-11 border border-seal px-3 py-2 font-mono text-xs text-seal">{message("researchChat.stopResearch")}</button>}
      </div>}
      {privateClaims && !protectedDocument && <p role="status" className="mt-3 text-seal">{privateResearchCopy.fullNavigation}</p>}
      {visibleRequest && state.status === "error" && <div className="mb-3 border border-line bg-paper p-4">
        <p className="mb-2 text-sm text-ink-2"><UiText source={researchRecoveryCopy.review} /></p>
        <button type="button" className="min-h-11 border border-line px-4 py-2 font-mono text-xs" onClick={() => setReopened({
          id: --recoverySequence.current, question: visibleRequest.question, budget: state.budget, researchPaused: false, replace: true,
          binding: { wallet: visibleRequest.publication.expectedWallet, revision: visibleRequest.ownerRevision },
        })}><UiText source={researchRecoveryCopy.reopen} /></button>
      </div>}
      <AskForm disabled={streaming || privateClaims && !protectedDocument} onAsk={submit} payer={payer} questionCapUsdc={grantBinding.questionCapUsdc} parentId={hasTurns || initialRequest ? parentId ?? null : undefined} conversation={hasTurns} clearOnSubmit allowSharedPrefill={!initialRequest}
        parentVisibility={parentVisibility} publicationPreference={publicationPreference} showAnswerLanguageHelp={!privateClaims}
        restoreQuestion={recoverySelection ? { ...recoverySelection, expectedWallet: publicationPreference.wallet, expectedRevision: publicationPreference.identityRevision }
          : (visibleRequest && (state.errorKind === "research-paused" || state.errorKind === "rate-limit" || state.errorKind === "maintenance")
          ? { ...visibleRequest, researchPaused: state.errorKind === "research-paused", expectedWallet: visibleRequest.publication.expectedWallet, expectedRevision: visibleRequest.ownerRevision } : undefined)} />
      {!introduceProduct && payer === "treasury" && !hasTurns && <div className="mt-3"><SponsoredTrialNotice /></div>}
      {!privateClaims && <div className="mt-3"><SessionGrantPanel onBindingChange={handleBindingChange} /></div>}
      {privateClaims && claimStatus !== "none" && claimStatus !== "waiting" && <div className="mt-3 border border-line p-4" role="status">
        <p>{claimStatus === "available" ? privateResearchCopy.available : claimStatus === "opened" ? privateResearchCopy.opened : claimStatus === "lost" ? privateResearchCopy.lost : privateResearchCopy.failed}</p>
        {claimStatus === "available" && <button className="mt-2 min-h-11 underline" type="button" onClick={() => privateHandoff.open()}>{privateResearchCopy.open}</button>}
      </div>}
      {(!introduceProduct || hasTurns) && <>
      <p className="mt-3 text-xs text-ink-3">{message("researchChat.historyNotice")}</p>
      <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-ink-2" aria-label={message("researchChat.toolsLabel")}>
        {!privateClaims && <a href="/research/private" className="underline underline-offset-4">{privateResearchCopy.entry}</a>}
        <a href="/me/asks" className="underline underline-offset-4">{message("researchChat.savedReports")}</a>
        <a href={paidHref} className="underline underline-offset-4">{message("researchChat.paidResearch")}</a>
        <a href="/register" className="underline underline-offset-4">{message("researchChat.publishSource")}</a>
      </nav>
      </>}
    </div>
  </section>;
}
