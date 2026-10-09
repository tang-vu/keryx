"use client";

/**
 * SSE client for POST /api/ask. EventSource can't POST, so we use fetch + a
 * ReadableStream reader and parse the text/event-stream frames by hand
 * (`event: <name>\ndata: <json>\n\n`). Exposes the live trace, derived
 * decisions/citations/payments as they stream, and the final QueryRun.
 *
 * Browser co-sign extension:
 *   When the server emits a `sign-request` event (sessionId present + active grant),
 *   the hook builds the EIP-712 authorization with the session WalletClient and
 *   POSTs the signed header to /api/ask/sign — all without a MetaMask prompt.
 *   A getSessionWalletClient() accessor must be injected by the caller so the hook
 *   has no direct dependency on the grant state tree.
 */

import { useCallback, useRef, useState } from "react";
import { RESEARCH_PAUSED_MESSAGE } from "@/lib/research/availability-contract";
import { BROWSER_AUTHORIZATION_PROTOCOL } from "@/lib/payments/browser-authorization-protocol";
import type { WalletClient } from "viem";
import type { BrowserPaymentContext } from "@/lib/payments/browser-cosign-gateway";
import type {
  Citation,
  Decision,
  PaymentRecord,
  QueryRun,
  ResearchMode,
  TraceStep,
} from "@/lib/types";
import type { PaymentRequirementsInput } from "@/lib/x402-client-sign";
import type { SourceIndex } from "@/lib/payments/client-payto-allowlist";
import { isPaymentRecord } from "@/lib/payments/payment-state";
import { readSession } from "@/lib/session/session-storage";
import { BrowserSignBudget } from "./browser-sign-budget";
import { browserPaymentProfile } from "../browser-payment-profile";
import { parseSelectionDiagnostic, type SelectionDiagnostic } from "../research/selection-diagnostic";
import { isDecisionRecord } from "../research/decision-record";
import { decisionReviewSchema, type DecisionReview } from "../research/decision-review-types";

export type StreamMode = "real" | "offline";

export interface AskMeta {
  reviewOwner?: string | null;
  engine: string;
  mode: StreamMode;
  researchMode?: ResearchMode;
}

/**
 * Distinguishes an expected throttle from a real failure so the UI can respond
 * differently: `rate-limit` (research capacity used up → wait before another
 * request), `session-expired` (grant lapsed → recover prompt), `generic` (any
 * other failure → plain error box).
 */
export type AskErrorKind = "generic" | "rate-limit" | "session-expired" | "research-paused";

export interface AskStreamState {
  status: "idle" | "streaming" | "done" | "error";
  meta: AskMeta | null;
  /** Authorized budget (USDC) for the in-flight run; drives the live budget meter. */
  budget: number;
  steps: TraceStep[];
  decisions: Decision[];
  citations: Citation[];
  payments: PaymentRecord[];
  run: QueryRun | null;
  decisionReviews?: DecisionReview[];
  error: string | null;
  /** Caller-local diagnostic; never a completed research or payment record. */
  selectionDiagnostic?: SelectionDiagnostic;
  /** What kind of error this is, when status === "error". null otherwise. */
  errorKind: AskErrorKind | null;
  /** Seconds until the free-trial throttle resets, when errorKind === "rate-limit". */
  retryAfter: number | null;
}

const INITIAL: AskStreamState = {
  status: "idle",
  meta: null,
  budget: 0,
  steps: [],
  decisions: [],
  citations: [],
  payments: [],
  run: null,
  error: null,
  errorKind: null,
  retryAfter: null,
};

/** Parse a single SSE frame block into [event, data]. */
function parseFrame(block: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

interface AskStreamOpts {
  /** Mainnet worker reads the authenticated journal original itself; SSE is notification only. */
  authorizeSessionPayment?: (reqId: string, question: import("../session/browser-session-runtime").BrowserQuestionBudget) => Promise<string>;
  /**
   * Returns the viem WalletClient backed by the session private key, or null
   * when no session is active. Injected to avoid coupling to useSessionGrant.
   */
  getSessionWalletClient?: () => WalletClient | null;
  /** Session id to include in the /api/ask POST body (= lowercased SIWE address). */
  sessionId?: string | null;
  /**
   * The funded grant cap in USDC. When set, the browser refuses to sign
   * once its own running total for this ask() run would exceed the cap.
   * This is the browser's independent authority — it does NOT rely on the server.
   */
  grantCap?: number;
  /** Owner-signed mainnet research maximum. The worker verifies it independently. */
  questionCapUsdc?: number;
  /**
   * Public source index fetched once from /api/sources. Every payTo the browser signs
   * for — fetch toll or citation reward — is validated against the wallets the on-chain
   * registry authorises for that exact source. Empty index refuses signing.
   */
  sourceIndex?: SourceIndex;
  /**
   * Called when the server rejects an ask with 401 `session_expired` (the grant TTL
   * lapsed or was dropped on restart). Lets the caller flip the grant UI to its
   * "expired" state so the user is prompted to recover instead of seeing a raw error.
   */
  onSessionExpired?: () => void;
}

export function useAskStream(opts?: AskStreamOpts) {
  const {
    getSessionWalletClient,
    authorizeSessionPayment,
    sessionId,
    grantCap,
    questionCapUsdc,
    sourceIndex,
    onSessionExpired,
  } = opts ?? {};
  const [state, setState] = useState<AskStreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  // Per-ask exact micro-USDC capacity; a reservation is taken before async checks.
  const signBudgetRef = useRef<BrowserSignBudget | null>(null);
  const questionBudgetRef = useRef<import("../session/browser-session-runtime").BrowserQuestionBudget | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    signBudgetRef.current = null;
    questionBudgetRef.current = null;
    setState(INITIAL);
  }, []);

  const handleEvent = useCallback((event: string, raw: string, question: import("../session/browser-session-runtime").BrowserQuestionBudget | null) => {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (event === "meta") {
      setState((s) => ({ ...s, meta: data as AskMeta }));
      return;
    }
    if (["decision-review", "decision-review-request", "decision-review-result"].includes(event)) {
      const parsed = decisionReviewSchema.safeParse(data);
      if (parsed.success) setState(s => ({ ...s, decisionReviews: [...(s.decisionReviews ?? []).filter(row => row.id !== parsed.data.id), parsed.data] }));
      return;
    }

    if (event === "step") {
      const step = data as TraceStep;
      setState((s) => {
        const next: AskStreamState = { ...s, steps: [...s.steps, step] };
        if (step.phase === "decide" && isDecisionRecord(step.detail)) {
          next.decisions = [...s.decisions, step.detail];
        }
        if (step.phase === "attribute" && step.detail) {
          next.citations = [...s.citations, step.detail as Citation];
        }
        if (step.phase === "settle" && isPaymentRecord(step.detail)) {
          next.payments = [...s.payments, step.detail];
        }
        return next;
      });
      return;
    }

    if (event === "sign-request") {
      // Browser co-sign: the server asks us to sign an EIP-712 payment authorization.
      // We do this in the background — no await in the event loop, fire-and-forget promise.
      // `kind` also rides this event: fetches require the exact registry payout wallet,
      // while citation rewards may target any registry-authorised author wallet.
      const { reqId, requirements, sourceId, kind, paymentContext, capturedGrantSigner, admittedNonce, browserAuthorizationProtocol } = data as {
        reqId: string;
        requirements: PaymentRequirementsInput;
        sourceId?: string;
        kind?: "fetch" | "citation";
        paymentContext?: BrowserPaymentContext;
        capturedGrantSigner?: string;
        admittedNonce?: string;
        browserAuthorizationProtocol?: string;
      };
      if (browserAuthorizationProtocol !== BROWSER_AUTHORIZATION_PROTOCOL ||
          typeof admittedNonce !== "string" || !/^0x[0-9a-f]{64}$/.test(admittedNonce)) {
        console.warn("[keryx] sign-request refused: durable authorization protocol missing");
        return;
      }
      const getWallet = getSessionWalletClient;

      if (!browserPaymentProfile().testnet) {
        if (!sessionId || !authorizeSessionPayment || !question || questionBudgetRef.current !== question) return;
        void authorizeSessionPayment(reqId, question).then(async paymentHeader => {
          if (questionBudgetRef.current !== question) throw new Error("Question changed; signed liability remains retained");
          const response = await fetch("/api/ask/sign", { method: "POST", credentials: "same-origin", redirect: "error",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, reqId, paymentHeader }),
            signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error("Payment callback unavailable; signed liability remains retained");
          await response.body?.cancel();
        }).catch(() => { console.warn("[keryx] mainnet payment leg refused; other answer sources continue"); });
        return;
      }

      if (!sessionId || !getWallet) {
        // No session configured — server shouldn't be sending sign-requests, but handle gracefully.
        console.warn("[keryx] received sign-request but no session wallet configured");
        return;
      }

      const budget = signBudgetRef.current;
      const reservation = budget?.reserve(requirements?.amount);
      if (!reservation) {
        console.warn("[keryx] sign-request refused: local cap unavailable, invalid amount, or cap exceeded");
        return;
      }

      // Import only after the synchronous cap reservation.
      import("@/lib/x402-client-sign").then(async ({ signBrowserPaymentAuthorization }) => {
        try {
          const walletClient = getWallet();
          if (!walletClient) {
            console.warn("[keryx] sign-request: session WalletClient not available");
            return;
          }
          const localSession = readSession();
          if (!localSession || localSession.sessionId.toLowerCase() !== sessionId.toLowerCase()) {
            console.warn("[keryx] sign-request refused: no matching local grant snapshot");
            return;
          }

          // payTo validation — the last gate before a bearer authorization exists.
          // Fetch tolls are checked against the source payout wallet; citation rewards
          // use the registry's full author allowlist. A sourceId the browser
          // never saw in /api/sources, or a registry it cannot read, means refuse: the
          // server's timeout skips the source, which costs a reward, not the user's USDC.
          //
          const index = sourceIndex;
          if (!sourceId || !index || index.size === 0 || !["fetch", "citation"].includes(kind ?? "")) {
            console.warn(
              "[keryx] sign-request refused: source payment authority cannot be verified",
            );
            return;
          }
          {
            const { isPaymentPayeeAllowed, resolveSourcePaymentAuthority } = await import(
              "@/lib/payments/client-payto-allowlist"
            );
            const authority = await resolveSourcePaymentAuthority(sourceId, index, { refresh: true });
            if (!authority) {
              console.warn(
                `[keryx] sign-request refused: cannot establish the authorised payees for source ${sourceId}`,
              );
              return;
            }
            if (!isPaymentPayeeAllowed(authority, requirements.payTo, kind)) {
              console.warn(
                `[keryx] sign-request refused: payTo ${requirements.payTo} is not authorised for this ${kind ?? "payment"} on ${sourceId}`,
              );
              return;
            }

            // Fetch prices have independent browser authority too. List-price reads must equal the
            // registry ceiling. Discounted reads must carry a creator signature over this exact
            // article version, amount, and expiry; a compromised server cannot invent one.
            if (kind === "fetch") {
              const { validateBrowserFetchPrice } = await import(
                "@/lib/payments/browser-fetch-price-policy"
              );
              const priceDecision = await validateBrowserFetchPrice({
                sourceId,
                amountUsdc6: requirements.amount,
                authority,
                context: paymentContext,
              });
              if (!priceDecision.allowed) {
                console.warn(`[keryx] sign-request refused: ${priceDecision.reason}`);
                return;
              }
            }
          }

          try {
            const currentSession = readSession();
            if (!currentSession || currentSession.sessionId.toLowerCase() !== sessionId.toLowerCase() ||
                currentSession.sessAddr.toLowerCase() !== localSession.sessAddr.toLowerCase() ||
                signBudgetRef.current !== budget) {
              throw new Error("local grant changed before signing");
            }
            reservation.markSigningStarted();
            const { header } = await signBrowserPaymentAuthorization(
              walletClient, requirements, localSession.sessAddr, capturedGrantSigner ?? "", admittedNonce,
            );
            await fetch("/api/ask/sign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId, reqId, paymentHeader: header }),
            });
          } catch (err) {
            // Signing failed — log but don't crash the UI. The server's awaitSignature
            // timeout will reject and the gateway will skip this source gracefully.
            console.error("[keryx] sign-request failed:", err);
          }
        } finally {
          reservation.releaseBeforeSigning();
        }
      }).catch((err) => {
        reservation.releaseBeforeSigning();
        console.error("[keryx] failed to load x402-client-sign:", err);
      });
      return;
    }

    if (event === "done") {
      const run = data as QueryRun;
      setState((s) => ({
        ...s,
        status: "done",
        run,
        // Canonical decisions still require the display shape used for streamed rows.
        decisions: Array.isArray(run.decisions) && run.decisions.length ? run.decisions.filter(isDecisionRecord) : s.decisions,
        citations: run.citations?.length ? run.citations : s.citations,
      }));
      return;
    }

    if (event === "error") {
      const { message, code, selectionDiagnostic } = data as { message: string; code?: string; selectionDiagnostic?: unknown };
      const diagnostic = parseSelectionDiagnostic(selectionDiagnostic);
      setState((s) => ({ ...s, status: "error", errorKind: code === "research_paused" ? "research-paused" : "generic",
        error: code === "research_paused" ? RESEARCH_PAUSED_MESSAGE : message,
        selectionDiagnostic: diagnostic?.outcome === "refused" ? diagnostic : undefined }));
    }
  // opts is an object reference — destructure the primitive/stable values into the dep array
  // so the hook re-creates handleEvent when the grant activates or the cap changes.
  // sourceIndex is a Map: stable after the one-time /api/sources fetch in app/page.tsx.
  }, [sessionId, getSessionWalletClient, authorizeSessionPayment, sourceIndex]);

  const ask = useCallback(
    async (
      question: string,
      budget: number,
      parentId?: string,
      model?: string,
      researchMode: ResearchMode = "quick",
      scholarly = false,
      paidScholarly = false,
      reviewFirst = false,
    ) => {
      reset();
      // Reset reservations for this ask before any SSE frame can arrive.
      signBudgetRef.current = new BrowserSignBudget(grantCap);
      if (!browserPaymentProfile().testnet) {
        const micros = Math.round(budget*1e6);
        if (!Number.isSafeInteger(micros) || micros < 0 || Math.abs(budget*1e6-micros) > 0.000001)
          throw new Error("Question budget must be a non-negative integer amount of micro-USDC");
        if (sessionId && questionCapUsdc !== undefined && (!Number.isFinite(questionCapUsdc) || questionCapUsdc <= 0 ||
          micros > Math.round(questionCapUsdc*1e6))) {
          setState({ ...INITIAL, status: "error", errorKind: "generic",
            error: "This question exceeds your signed per-question research maximum. Lower its budget or explicitly update your research budget." });
          return;
        }
        // A free-only question carries no signing authority, even if a session is connected.
        questionBudgetRef.current = micros === 0 ? null : { id: crypto.randomUUID(), budgetMicroUsdc: String(micros) };
      }
      const controller = new AbortController();
      abortRef.current = controller;
      // Reset/Stop can start another ask while an old body or reader rejects.
      // Its callbacks must not change the new turn or process old signing frames.
      const isCurrent = () => abortRef.current === controller && !controller.signal.aborted;
      const questionScope = questionBudgetRef.current;
      setState({ ...INITIAL, status: "streaming", budget });

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            budget,
            // Include session id when a browser co-sign grant is active.
            ...(sessionId ? { sessionId, browserAuthorizationProtocol: BROWSER_AUTHORIZATION_PROTOCOL } : {}),
            // Follow-up: the server anchors the question to this dispatch's own question.
            ...(parentId ? { parentId } : {}),
            // Reasoning-model pick from the form's picker. Server-validated against the
            // catalog; unknown/unset runs the default, and every pick falls back on error.
            ...(model ? { model } : {}),
            mode: researchMode,
            ...(scholarly ? { scholarly: true } : {}),
            ...(paidScholarly ? { paidScholarly: true } : {}),
            ...(reviewFirst ? { reviewFirst: true } : {}),
          }),
          signal: controller.signal,
        });
        if (!isCurrent()) return;

        if (!res.ok || !res.body) {
          // Read the error body once (as text), then try JSON — so we can react to a
          // structured session_expired without consuming the stream body twice.
          const bodyText = await res.text().catch(() => "");
          if (!isCurrent()) return;
          let errCode: string | undefined;
          let errMsg = bodyText;
          const retryHeader = res.headers.get("Retry-After");
          let retryAfter: number | null = retryHeader && /^[0-9]{1,6}$/.test(retryHeader)
            ? Number(retryHeader) : null;
          try {
            const j = JSON.parse(bodyText) as { error?: string; message?: string; retryAfter?: number };
            errCode = j.error;
            errMsg = j.message ?? j.error ?? bodyText;
            if (typeof j.retryAfter === "number" && Number.isFinite(j.retryAfter) && j.retryAfter >= 0)
              retryAfter = j.retryAfter;
          } catch { /* not JSON — keep the raw text */ }

          if (errCode === "research_paused") {
            setState((s) => ({ ...s, status: "error", errorKind: "research-paused", error: RESEARCH_PAUSED_MESSAGE }));
            return;
          }

          if (res.status === 401 && errCode === "session_expired") {
            // Flip the grant UI to "expired" so the user gets the recover prompt.
            onSessionExpired?.();
            setState((s) => ({
              ...s,
              status: "error",
              errorKind: "session-expired",
              error: errMsg || "Your spending session expired — recover it to continue.",
            }));
            return;
          }

          if (res.status === 429) {
            // Free-trial throttle on the anonymous treasury path — an expected limit, not a
            // failure. Keep recovery available without requiring wallet funding.
            setState((s) => ({
              ...s,
              status: "error",
              errorKind: "rate-limit",
              retryAfter,
              error:
                errMsg ||
                "Research capacity is temporarily full. Try again shortly.",
            }));
            return;
          }

          setState((s) => ({ ...s, status: "error", errorKind: "generic", error: errMsg || `HTTP ${res.status}` }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamDone = false;

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (!isCurrent()) return;
          if (done) {
            streamDone = true;
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          // Frames are separated by a blank line.
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const frame = parseFrame(block);
            if (frame) handleEvent(frame.event, frame.data, questionScope);
          }
        }

        // Flush any trailing frame.
        const tail = parseFrame(buffer);
        if (!isCurrent()) return;
        if (tail) handleEvent(tail.event, tail.data, questionScope);

        setState((s) => {
          // A `done` or `error` event already moved us out of "streaming" — keep that.
          if (s.status !== "streaming") return s;
          // Otherwise the stream ended with no terminal event (server restart, dropped
          // connection): don't freeze on a "done" with no answer — surface a retryable error.
          return s.run
            ? { ...s, status: "done" }
            : {
                ...s,
                status: "error",
                errorKind: "generic",
                error: "The connection dropped before the dispatch finished — please try again.",
              };
        });
      } catch (err) {
        if (!isCurrent()) return;
        if ((err as Error)?.name === "AbortError") return;
        setState((s) => ({
          ...s,
          status: "error",
          errorKind: "generic",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [handleEvent, reset, sessionId, grantCap, questionCapUsdc, onSessionExpired],
  );

  return { state, ask, reset };
}
