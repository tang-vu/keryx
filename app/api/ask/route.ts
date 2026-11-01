/**
 * Streaming agent endpoint. POST { question, budget, sessionId? } → Server-Sent Events:
 *   event: meta         → { engine, mode } once at start
 *   event: step         → each TraceStep as the agent reasons/pays
 *   event: sign-request → { reqId, requirements, kind, sourceId } when browser co-sign is active
 *   event: done         → the final QueryRun
 *   event: error        → failure
 *
 * Browser co-sign path (sessionId present + active grant):
 *   On each BUY the BrowserCoSignGateway emits a `sign-request` SSE event.
 *   The browser signs with its session key and POSTs back to /api/ask/sign,
 *   which resolves the pending promise so the gateway can retry the source.
 *   No private key is held server-side for user sessions.
 *
 * No-session path: falls through to RealGateway (treasury) or OfflineGateway —
 * the existing behavior is fully preserved.
 */

import { isRequestObject } from "@/lib/request-object";
import { NextRequest } from "next/server";
import { hostedRequesterObservations } from "@/lib/research-feedback/hosted-delivery";
import { BROWSER_AUTHORIZATION_PROTOCOL } from "@/lib/payments/browser-authorization-protocol";
import { getSession } from "@/lib/auth";
import { accountSessionContext } from "@/lib/account-sessions";
import { assertDecisionReviewAuthority } from "@/lib/research/decision-review-authority";
import { getAgentDeps } from "@/lib/agent";
import { runAgent } from "@/lib/agent/run-agent";
import { ResearchPlanningError, researchFailureMessage } from "@/lib/llm/research-plan";
import { parsePlanningFailure } from "@/lib/research/planning-failure";
import { effectiveEngineName, reasoningAttempts, reasoningUsage, reasoningCalls } from "@/lib/llm/resilient-engine";
import { outputTokenLimitFromValidatedError } from "@/lib/llm/reasoning-engine";
import { askStreamWriter } from "@/lib/research/ask-stream-lifecycle";
import { ResearchSelectionError } from "@/lib/llm/research-selection";
import { config } from "@/lib/config";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { checkSponsoredResearchAdmission } from "@/lib/sponsored-admission";
import { getDb } from "@/lib/db";
import { resolveDispatch } from "@/lib/history/read-dispatch";
import { privacyReadsActive, type RunVisibility } from "@/lib/run-privacy/contracts";
import { privacyBinding } from "@/lib/run-privacy/auth";
import { prepareAskPublication } from "@/lib/run-privacy/ask-publication";
import { PublicationError } from "@/lib/run-privacy/publication";
import { resolveFollowUpQuestion, type FollowUpParent } from "@/lib/agent/follow-up-question";
import { getGrant } from "@/lib/payments/session-grants";
import { isPaymentRecord } from "@/lib/payments/payment-state";
import { awaitSignature } from "@/lib/payments/pending-signatures";
import type {
  BrowserPaymentContext,
  PaymentRequirements,
} from "@/lib/payments/browser-cosign-gateway";
import type { QueryRun, ResearchMode, TraceStep } from "@/lib/types";
import { newRunUsage } from "@/lib/research/usage-provenance";
import { sponsoredUsageContext } from "@/lib/research/sponsored-usage";
import { parseAskQuestion, parseResearchMode } from "@/lib/ask-input";
import { recordActivationEvent } from "@/lib/activation";
import { isAddress } from "viem";
import { readRetainedMainnetSessionAuthority } from "@/lib/payments/retained-session-authority";
import { readResearchAvailability } from "@/lib/research/availability";
import { researchAdmissionError } from "@/lib/research/availability-contract";
import { isConfiguredSameOrigin } from "@/lib/auth-origin";
import { createLiveDecisionReviews } from "@/lib/research/decision-review-live";
import { unsupportedDecisionReviewIntent, type DecisionReviewsStore } from "@/lib/research/decision-review-types";
import { hostedRunClaimsEnabled, prepareHostedRunClaim } from "@/lib/run-claims/hosted-delivery";
import { admitsPrivateAsk, PRIVATE_DOCUMENT_HEADER } from "@/lib/run-claims/web-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  if (!isRequestObject(body)) {
    return Response.json({ error: "request body must be a JSON object" }, { status: 400 });
  }
  if (body.reviewFirst !== undefined && typeof body.reviewFirst !== "boolean") return Response.json({ error: "reviewFirst must be a boolean" }, { status: 400 });
  if (unsupportedDecisionReviewIntent({ ...body, reviewFirst: false })) return Response.json({ error: "review_unsupported" }, { status: 400 });
  if (body.reviewFirst === true && (!body.sessionId || req.nextUrl.searchParams.has("bot") || !isConfiguredSameOrigin(req, config.baseUrl)))
    return Response.json({ error: "review_unsupported", message: "Review-first requires an authenticated browser session on this origin." }, { status: 409 });
  // Model pick from the UI's picker. Validated inside getAgentDeps → resolveModelChoice:
  // unknown/unconfigured ids silently run the default engine, and every pick has a
  // Configured-provider → heuristic fallback chain, so a crafted value can never fail an ask.
  const model =
    typeof body.model === "string" ? body.model.trim().slice(0, 64) || undefined : undefined;
  const parsedQuestion = parseAskQuestion(body.question);
  if (!parsedQuestion.success) {
    return Response.json({ error: parsedQuestion.error }, { status: 400 });
  }
  const question = parsedQuestion.question;
  const researchMode: ResearchMode = parseResearchMode(body.mode);
  if (body.scholarly !== undefined && typeof body.scholarly !== "boolean") {
    return Response.json({ error: "scholarly must be a boolean" }, { status: 400 });
  }
  if (body.paidScholarly !== undefined && typeof body.paidScholarly !== "boolean")
    return Response.json({ error: "paidScholarly must be a boolean" }, { status: 400 });
  if (body.paidScholarly === true && body.sessionId === undefined)
    return Response.json({ error: "Paid scholarly pilot requires your funded browser session" }, { status: 409 });

  // A present session id means "spend my browser-funded grant". Never coerce a malformed value or
  // silently reinterpret an empty one as the anonymous treasury path.
  let sessionId: string | undefined;
  const availability = readResearchAvailability();
  if (availability.state === "paused") return Response.json({ error: "research_paused",
    message: availability.message, availability }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (body.sessionId !== undefined) {
    if (typeof body.sessionId !== "string" || !isAddress(body.sessionId.trim())) {
      return Response.json({ error: "sessionId must be a valid wallet address" }, { status: 400 });
    }
    sessionId = body.sessionId.trim().toLowerCase();
    if (process.env.KERYX_BROWSER_AUTHORIZATION_PAUSED === "1") {
      return Response.json({ error: "browser_authorization_paused" }, { status: 503 });
    }
    if (body.browserAuthorizationProtocol !== BROWSER_AUTHORIZATION_PROTOCOL) {
      return Response.json({ error: "browser_authorization_upgrade_required" }, { status: 409 });
    }
    if (!(await (await getDb()).browserJournalActive())) {
      return Response.json({ error: "browser_authorization_cutover_pending" }, { status: 503 });
    }
  }

  // Keep validated caller text distinct from bounded, authorized question-only
  // ancestry. Prior answers are never input; unknown immediate parents stay standalone.
  const asker = (await getSession())?.address?.toLowerCase();
  let parentId: string | undefined;
  let parentVisibility: RunVisibility | undefined;
  let askQuestion = question;
  let readFollowUpParent: ((id: string) => Promise<FollowUpParent | null>) | undefined;
  const requestedParentId =
    typeof body.parentId === "string" && body.parentId.trim() && body.parentId.trim().length <= 256 ? body.parentId.trim() : undefined;
  if (requestedParentId) {
    const parentDb=await getDb();
    const actor = asker && privacyReadsActive(parentDb) ? { wallet: asker, binding: privacyBinding() } : undefined;
    const parent = await resolveDispatch(requestedParentId, parentDb, actor);
    if (parent) {
      const onlyQuestion = (value: NonNullable<typeof parent>): FollowUpParent => ({
        id: value.run.id, question: value.run.question, parentId: value.run.parentId, visibility: value.visibility,
      });
      const initial = onlyQuestion(parent);
      parentId = initial.id; parentVisibility = initial.visibility;
      readFollowUpParent = async id => {
        if (id === requestedParentId) return initial;
        const ancestor = await resolveDispatch(id, parentDb, actor);
        return ancestor ? onlyQuestion(ancestor) : null;
      };
    }
  }

  // Who gets this dispatch in their ledger. Read from the SIWE cookie — the one wallet claim the
  // server has actually verified — and read HERE, in request scope: the stream body below runs
  // after the handler returns, where cookies() is no longer available. A signed-out ask stays
  // unattributed rather than borrowing `sessionId`, which is client-supplied.

  // A session id is a public wallet address, not a bearer secret. Bind the browser co-sign path to
  // the SIWE identity that created the grant before exempting it from the treasury rate limit or
  // exposing sign-request ids. Otherwise another caller could reserve a known wallet's cap with
  // bogus headers and use that victim session as an unmetered LLM front door.
  if (sessionId && !asker) {
    return Response.json(
      {
        error: "session_auth_required",
        message: "Sign in with the wallet that created this spending session.",
      },
      { status: 401 },
    );
  }
  if (sessionId && asker !== sessionId) {
    return Response.json(
      {
        error: "session_owner_mismatch",
        message: "This spending session belongs to a different wallet.",
      },
      { status: 403 },
    );
  }

  // If the client presents a session but the server grant is gone (TTL lapsed, or the user
  // revoked it), do NOT silently fall back to the treasury gateway — that would spend Keryx's
  // own USDC for a user who meant to spend their own. Tell the client to recover (re-derive the
  // key + re-register the grant against the live Gateway balance). Grants now survive a restart,
  // so a deploy no longer lands here. A request with NO sessionId is the legitimate
  // anonymous/treasury path and is left untouched.
  const grant = sessionId ? await getGrant(sessionId) : undefined;
  if (sessionId && (!grant || grant.ownerAddr.toLowerCase() !== asker)) {
    return Response.json(
      {
        error: "session_expired",
        message: "Your spending session expired — recover it to continue.",
      },
      { status: 401 },
    );
  }
  const useBrowserCoSign = Boolean(sessionId);
  const reviewDb = asker ? await getDb() : undefined;
  let reviewStore: DecisionReviewsStore | undefined;
  try {
    reviewStore = reviewDb?.decisionReviews;
    if (reviewStore) await reviewStore.ready();
  } catch {
    // Strict enrolled facades refuse undeclared capabilities; selection failures stay outside.
    reviewStore = undefined;
  }
  if (body.reviewFirst === true && !reviewStore) return Response.json({ error: "review_unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
  const reviewSession = body.reviewFirst === true ? await accountSessionContext() : undefined;
  if (reviewSession instanceof Response) return reviewSession;
  if (reviewSession && reviewSession.wallet !== asker) return Response.json({ error: "review_owner_changed" }, { status: 409 });
  let publication: Awaited<ReturnType<typeof prepareAskPublication>>;
  try { publication = await prepareAskPublication(req, body.visibility, asker, parentVisibility); }
  catch (error) {
    return Response.json({ error: error instanceof PublicationError ? error.code : "visibility_unavailable",
      message: error instanceof PublicationError ? error.message : "Question visibility is unavailable. Please try again." },
    { status: error instanceof PublicationError ? error.status : 503, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie, X-Keryx-Expected-Wallet" } });
  }
  let questionCapUsdc = config.sessionAskMaxBudget;
  if (useBrowserCoSign && grant && config.profile.name === "arc") {
    try {
      const { consent } = await readRetainedMainnetSessionAuthority(await getDb(), grant.ownerAddr.toLowerCase(), grant.grantEpoch, grant.sessAddr.toLowerCase());
      if (Number(consent.capMicroUsdc) !== Math.round(grant.cap*1e6) || Number(consent.expirySeconds)*1000 !== grant.expiry)
        throw new Error("Research budget changed");
      if (consent.format === "keryx-session-grant-consent-v2") questionCapUsdc = Math.min(questionCapUsdc, Number(consent.questionCapMicroUsdc)/1e6);
    } catch {
      return Response.json({ error: "session_policy_unavailable", message: "Your signed research budget could not be verified. Restore it before asking again." }, { status: 503 });
    }
  }

  // Anonymous requests are IP-limited against treasury drain. Browser co-sign payments are
  // grant-funded, but their model/search compute is separately limited by verified owner wallet.
  if (useBrowserCoSign && sessionId) {
    const limited = await checkRateLimit(sessionId, "sessionAsk", {
      code: "session_rate_limit",
      message: "This wallet has dispatched several questions recently. Try again shortly.",
    });
    if (limited) return limited;
  } else {
    const limited = await checkSponsoredResearchAdmission({ kind: "anonymous", ip: clientIp(req), wallet: asker });
    if (limited) return limited;
  }

  const coercedBudget =
    typeof body.budget === "number" && Number.isFinite(body.budget) && body.budget >= 0
      ? body.budget
      : config.defaultBudget;
  const remainingGrantUsdc = grant
    ? Math.max(
        0,
        Math.round(grant.cap * 1_000_000) - Math.round(grant.spent * 1_000_000),
      ) / 1_000_000
    : undefined;
  if (useBrowserCoSign && coercedBudget > 0 && (!remainingGrantUsdc || remainingGrantUsdc <= 0)) {
    return Response.json(
      {
        error: "session_budget_exhausted",
        message: "This spending session has no unreserved USDC left.",
      },
      { status: 402 },
    );
  }
  const askBudget = useBrowserCoSign
    ? Math.min(coercedBudget, remainingGrantUsdc!, questionCapUsdc)
    : Math.min(coercedBudget, config.anonMaxBudget);

  // The existing immediate-parent/publication guards run before admission.
  // Additional ancestry reads require that admission and reuse the captured parent.
  if (readFollowUpParent && requestedParentId) {
    const context = await resolveFollowUpQuestion({ question, parentId: requestedParentId, read: readFollowUpParent, signal: req.signal });
    parentId = context.parentId; askQuestion = context.researchQuestion;
    if (context.parentVisibility !== parentVisibility) {
      try { publication = await prepareAskPublication(req, body.visibility, asker, context.parentVisibility); }
      catch (error) {
        return Response.json({ error: error instanceof PublicationError ? error.code : "visibility_unavailable",
          message: error instanceof PublicationError ? error.message : "Question visibility is unavailable. Please try again." },
        { status: error instanceof PublicationError ? error.status : 503, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie, X-Keryx-Expected-Wallet" } });
      }
    }
  }

  const isBot = !!config.botKey && req.nextUrl.searchParams.get("bot") === config.botKey;
  const queryId = crypto.randomUUID();
  let privateClaim: Awaited<ReturnType<typeof prepareHostedRunClaim>> | undefined;
  const privateClaimRequested = req.headers.has(PRIVATE_DOCUMENT_HEADER);
  if (privateClaimRequested && !hostedRunClaimsEnabled())
    return Response.json({ error: "claims_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (privateClaimRequested && !admitsPrivateAsk(req, { origin: config.baseUrl, network: config.networkId }, config.jwtSecret))
    return Response.json({ error: "private_research_document_required" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (privateClaimRequested && !asker && !isBot) {
    try { privateClaim = await prepareHostedRunClaim(queryId); }
    catch { return Response.json({ error: "claims_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  }
  if (!isBot) {
    await recordActivationEvent(await getDb(), "reader_ask_started");
  }

  // AbortController tied to the client connection so sign-request promises are
  // cancelled when the browser disconnects mid-run.
  const abort = new AbortController();
  // Retain the dispatch from the trusted payment boundary, before a gateway call or its ledger
  // writes can suspend. This is conservative retention, never evidence of settlement. Browser
  // signing still stops with the connection, and no new creator payment starts after disconnect.
  const agentAbort = new AbortController();
  let retainPaymentHistory = false;
  const disconnect = () => {
    abort.abort();
    if (!retainPaymentHistory) agentAbort.abort();
  };
  req.signal.addEventListener("abort", disconnect, { once: true });
  if (req.signal.aborted) disconnect();

  const stream = new ReadableStream({
    async start(controller) {
      const writer = askStreamWriter(controller, abort.signal);
      const send = writer.send;
      const reviewAdapter = asker && reviewStore ? createLiveDecisionReviews({
        owner: asker, store: reviewStore, reviewFirst: body.reviewFirst === true, signal: abort.signal, send, sessionHash: reviewSession?.currentId ?? null,
        cohort: isBot ? "scripted" : config.devWallets.includes(asker) ? "team" : "unknown",
        cohortEvidence: isBot ? "authenticated-bot-route" : config.devWallets.includes(asker) ? "configured-dev-wallet" : null,
        verifyOwnerAndGrant: async () => {
          const current = sessionId ? await getGrant(sessionId) : undefined;
          const session = reviewSession ? await reviewSession.db.getWebSession(reviewSession.currentId) : null;
          assertDecisionReviewAuthority(asker, reviewSession?.currentId ?? "", session, grant, current);
        },
      }) : undefined;

      let deps: Awaited<ReturnType<typeof getAgentDeps>> | undefined;
      let usageContext: object | undefined;
      const planningTrace: TraceStep[] = [], startedAt = Date.now();
      try {

        if (useBrowserCoSign && sessionId) {
          // Build the requestSignature callback that the BrowserCoSignGateway calls for each BUY.
          // It emits the payment requirements plus article/offer proof in an SSE sign-request
          // event and suspends until /api/ask/sign resolves it.
          // sessionId is narrowed (non-null) by the useBrowserCoSign guard above.
          const capturedSessionId = sessionId;
          const requestSignature = (
            reqId: string,
            requirements: PaymentRequirements,
            kind: "fetch" | "citation",
            sourceId: string,
            paymentContext: BrowserPaymentContext | undefined,
            admittedNonce: string,
          ): Promise<string> => {
            // Arm the scoped slot before SSE delivery so a fast callback cannot race creation.
            const signed = awaitSignature(capturedSessionId, reqId, {
              requirements,
              expectedSigner: grant!.sessAddr,
              expectedNonce: admittedNonce,
            }, abort.signal);
            send("sign-request", {
              reqId, requirements, kind, sourceId, paymentContext,
              capturedGrantSigner: grant?.sessAddr,
              admittedNonce, browserAuthorizationProtocol: BROWSER_AUTHORIZATION_PROTOCOL,
            });
            return signed;
          };

          deps = await getAgentDeps({
            gatewayOpts: {
              sessionId,
              requestSignature,
              abortSignal: abort.signal,
            },
            model,
          });
        } else {
          deps = await getAgentDeps({ model });
        }

        if (agentAbort.signal.aborted) throw new DOMException("Research cancelled", "AbortError");
        usageContext = sponsoredUsageContext({ network: config.profile.networkId, queryId, origin: config.baseUrl,
          gateway: deps.gateway, sponsored: !useBrowserCoSign, scripted: isBot, asker,
          provenance: { version: 1, surface: "web", ownershipMethod: asker ? "session" : "unknown" },
          teamWallets: config.devWallets ?? [] });
        send("meta", { engine: deps.engine.name, mode: deps.gateway.mode, researchMode, visibility: publication.visibility,
          ...(!privateClaimRequested && (publication.visibility === "public" || publication.visibility === "unlisted") ? { reportId: queryId } : {}),
          ...(publication.visibility === "private" ? { visibilityOwner: asker } : {}), ...(reviewAdapter ? { reviewOwner: asker } : {}) });
        // Preserve the execution origin for audit. A manual internal client with the bot key
        // can be tagged `engine`; ordinary requests through this route are tagged `web`.
        const gen = runAgent(
          {
            queryId,
            reviewFirst: body.reviewFirst === true,
            decisionReviews: reviewAdapter?.reviews,
            question: askQuestion,
            originalQuestion: question,
            signal: agentAbort.signal,
            budget: askBudget,
            // Verified SIWE wallet only. Keeps a treasury-funded run from buying or rewarding the
            // asker's own sources.
            asker,
            provenance: { version: 1, surface: "web", ownershipMethod: asker ? "session" : "unknown" },
            usageContext,
            researchMode,
            scholarly: body.scholarly === true,
            paidScholarly: body.paidScholarly === true,
            origin: isBot ? "engine" : "web",
            fundingOwner: useBrowserCoSign ? "browser" : "treasury",
            onCreatorPaymentBoundary: async () => {
              if (abort.signal.aborted) throw new Error("Client disconnected before a new creator payment could start");
              retainPaymentHistory = true;
            },
          },
          deps,
        );
        let res = await gen.next();
        while (!res.done) {
          planningTrace.push(res.value);
          send("step", res.value);
          if (isPaymentRecord(res.value.detail)) retainPaymentHistory = true;
          res = await gen.next();
          if (agentAbort.signal.aborted) break;
        }
        // When the generator is done (res.done === true), res.value is QueryRun.
        // If we broke early due to abort, skip saving — the run is incomplete.
        if (res.done) {
          const run = res.value as QueryRun;
          // The agent reasons over askQuestion; history, returned reports and the
          // next follow-up retain only this request's validated caller question.
          run.question = question;
          let isReturning = false;
          if (!isBot && asker) {
            try {
              isReturning = (await deps.db.listQueryRunsByAsker(asker, 1)).length > 0;
            } catch {
              // Funnel classification is best-effort and must not strand a completed paid answer.
            }
          }
          if (parentId) run.parentId = parentId;
          if (asker) {
            run.asker = asker;
            // Only the co-sign path spends the asker's own funded session. A free-trial dispatch
            // by a signed-in wallet is still theirs to look back at, but the USDC was Keryx's —
            // never let it total up as the user's spend.
            run.askerFunded = useBrowserCoSign;
          }
          if (publication.privacyActive) await deps.db.saveQueryRun(run, { visibility: publication.visibility });
          else await deps.db.saveQueryRun(run);
          // Saved original and payment state remain separate from the one-shot
          // caller-private transport. A late claim failure preserves the answer.
          const claimPacket = await privateClaim?.complete(run);
          if (!isBot) {
            await recordActivationEvent(deps.db, "reader_answer_completed");
            if (isReturning) {
              await recordActivationEvent(deps.db, "reader_returning_dispatch");
            }
          }
          send("done", run);
          if (claimPacket) send("private-run-claim", claimPacket);
          const requesterPacket = !isBot ? await hostedRequesterObservations(run, publication.visibility === "public", deps.db) : null;
          if (requesterPacket) send("private-requester-observations", requesterPacket);
        }
      } catch (err) {
        const planningFailure = err instanceof ResearchPlanningError ? parsePlanningFailure({ version: 1, stage: "decompose",
          reason: err.reason, maximumTargets: err.maximumTargets, automaticRetry: false,
          ...(outputTokenLimitFromValidatedError(err) === undefined ? {} : { outputTokenLimit: outputTokenLimitFromValidatedError(err) }) }) : undefined;
        let reportSaved = false;
        let claimPacket: Awaited<ReturnType<NonNullable<typeof privateClaim>["complete"]>> | undefined;
        // A planning refusal precedes discovery/payment. Do not manufacture zero-spend
        // history for an arbitrary later-stage failure, cancellation or payment boundary.
        if (planningFailure && deps && !agentAbort.signal.aborted && !retainPaymentHistory && planningTrace.every(step => step.phase === "decompose")) {
          const provenance = { version: 1 as const, surface: "web" as const, ownershipMethod: asker ? "session" as const : "unknown" as const };
          const failed: QueryRun = { id: queryId, question, budget: askBudget, researchMode,
            engine: effectiveEngineName(deps.engine), planningFailure, provenance,
            usage: newRunUsage({ asker, provenance, usageContext }, config.profile.networkId, config.devWallets ?? []),
            reasoningAttempts: reasoningAttempts(deps.engine), llmUsage: reasoningUsage(deps.engine), llmCalls: reasoningCalls(deps.engine),
            subClaims: [], decisions: [], citations: [], evidence: [], claimCoverage: [],
            answer: researchFailureMessage(err), totalSpent: 0, totalToCreators: 0,
            trace: [...planningTrace, { phase: "verdict", message: "Research planning failed before discovery. No answer or source-payment result was produced.", detail: planningFailure, ts: Date.now() }],
            createdAt: new Date().toISOString(), origin: isBot ? "engine" : "web", fundingOwner: deps.gateway.mode === "offline" ? "offline" : useBrowserCoSign ? "browser" : "treasury",
            paymentMode: deps.gateway.mode, durationMs: Math.max(0, Date.now() - startedAt),
            ...(parentId ? { parentId } : {}), ...(asker ? { asker, askerFunded: useBrowserCoSign } : {}) };
          try {
            if (publication.privacyActive) await deps.db.saveQueryRun(failed, { visibility: publication.visibility });
            else await deps.db.saveQueryRun(failed);
            reportSaved = true;
            claimPacket = await privateClaim?.complete(failed);
          } catch { /* Keep the original refusal; no retry, raw storage error or false saved claim. */ }
        }
        send("error", { message: researchFailureMessage(err),
          ...(planningFailure ? { code: err instanceof ResearchPlanningError ? err.code : "research_plan_refinement_required", planningFailure, reportSaved,
            ...(reportSaved && privateClaim ? { failedReportId: queryId } : {}) } : {}),
          ...(researchAdmissionError(err) ? { code: "research_paused" } : {}),
          ...(err instanceof ResearchSelectionError ? { code: err.code, selectionDiagnostic: err.diagnostic } : {}) });
        if (claimPacket) send("private-run-claim", claimPacket);
      } finally {
        await reviewAdapter?.close(queryId).catch(() => undefined);
        req.signal.removeEventListener("abort", disconnect);
          writer.close();
      }
    },
    cancel() { disconnect(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": reviewStore || privateClaim || publication.visibility !== "public" ? "private, no-store, no-transform" : "no-cache, no-transform",
      ...(reviewStore || privateClaim || publication.visibility !== "public" ? { "Vary": "Cookie, X-Keryx-Expected-Wallet", "Referrer-Policy": "no-referrer" } : {}),
      Connection: "keep-alive",
      // Disable proxy response buffering so the live reasoning trace streams token-by-token
      // instead of arriving in one batch at the end. Honored by nginx and by the Cloudflare
      // edge in front of keryx.cc; without it a buffering proxy makes the trace look frozen.
      "X-Accel-Buffering": "no",
    },
  });
}
