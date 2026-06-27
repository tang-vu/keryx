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
import type { WalletClient } from "viem";
import type {
  Citation,
  Decision,
  PaymentRecord,
  QueryRun,
  TraceStep,
} from "@/lib/types";
import type { PaymentRequirementsInput } from "@/lib/x402-client-sign";

export type StreamMode = "real" | "offline";

export interface AskMeta {
  engine: string;
  mode: StreamMode;
}

/**
 * Distinguishes an expected throttle from a real failure so the UI can respond
 * differently: `rate-limit` (anonymous free-trial used up → invite to connect a
 * wallet), `session-expired` (grant lapsed → recover prompt), `generic` (any
 * other failure → plain error box).
 */
export type AskErrorKind = "generic" | "rate-limit" | "session-expired";

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
  error: string | null;
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
  /**
   * Set of known source payout wallet addresses (lowercased), fetched once
   * from /api/sources. When populated, fetch-toll payTo values are validated
   * against this set before signing. Citation payTo cannot be fully enumerated
   * (author wallets are not exposed) — cap enforcement is the containment there.
   */
  knownSourceWallets?: Set<string>;
  /**
   * Called when the server rejects an ask with 401 `session_expired` (the grant TTL
   * lapsed or was dropped on restart). Lets the caller flip the grant UI to its
   * "expired" state so the user is prompted to recover instead of seeing a raw error.
   */
  onSessionExpired?: () => void;
}

export function useAskStream(opts?: AskStreamOpts) {
  const [state, setState] = useState<AskStreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks the cumulative USDC the browser has signed in the current ask() run.
  // Reset to 0 at the start of each ask(). Never persisted. Independent of the server.
  const signedTotalRef = useRef<number>(0);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  const handleEvent = useCallback((event: string, raw: string) => {
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

    if (event === "step") {
      const step = data as TraceStep;
      setState((s) => {
        const next: AskStreamState = { ...s, steps: [...s.steps, step] };
        if (step.phase === "decide" && step.detail) {
          next.decisions = [...s.decisions, step.detail as Decision];
        }
        if (step.phase === "attribute" && step.detail) {
          next.citations = [...s.citations, step.detail as Citation];
        }
        if (step.phase === "settle" && step.detail) {
          next.payments = [...s.payments, step.detail as PaymentRecord];
        }
        return next;
      });
      return;
    }

    if (event === "sign-request") {
      // Browser co-sign: the server asks us to sign an EIP-712 payment authorization.
      // We do this in the background — no await in the event loop, fire-and-forget promise.
      const { reqId, requirements, kind } = data as {
        reqId: string;
        requirements: PaymentRequirementsInput;
        kind?: "fetch" | "citation";
      };
      const sessionId = opts?.sessionId;
      const getWallet = opts?.getSessionWalletClient;

      if (!sessionId || !getWallet) {
        // No session configured — server shouldn't be sending sign-requests, but handle gracefully.
        console.warn("[keryx] received sign-request but no session wallet configured");
        return;
      }

      // Import the signer lazily — only loaded when co-sign is active (tree-shakes for no-session path).
      import("@/lib/x402-client-sign").then(async ({ signPaymentAuthorization }) => {
        const walletClient = getWallet();
        if (!walletClient) {
          console.warn("[keryx] sign-request: session WalletClient not available");
          return;
        }

        // Browser-side independent cap enforcement.
        // Compute the payment amount in USDC (6-decimal atomic → float).
        const amountUsdc = Number(requirements.amount) / 1e6;

        // If a cap is configured, refuse to sign once the cumulative signed
        // total for this run would exceed it. Small epsilon (1e-9) for float rounding.
        const cap = opts?.grantCap;
        if (cap !== undefined) {
          if (signedTotalRef.current + amountUsdc > cap + 1e-9) {
            console.warn(
              `[keryx] sign-request refused: cumulative signed total ` +
              `${signedTotalRef.current.toFixed(6)} + ${amountUsdc.toFixed(6)} would exceed cap ${cap.toFixed(6)}`,
            );
            // Do NOT post to /api/ask/sign — server timeout fires and skips source gracefully.
            return;
          }
        }

        // payTo validation against known source wallets — FETCH TOLLS ONLY.
        // A fetch toll's payTo is a source payout wallet, exposed via /api/sources.
        // A citation reward's payTo is an AUTHOR wallet, which is deliberately NOT
        // exposed (author wallets can't be enumerated client-side); the cumulative cap
        // above is the containment for those. Applying this allow-list to citations
        // would refuse every payout and dead-end §III with a 30s sign-request timeout.
        const knownWallets = opts?.knownSourceWallets;
        if (kind !== "citation" && knownWallets && knownWallets.size > 0) {
          if (!knownWallets.has(requirements.payTo.toLowerCase())) {
            console.warn(
              `[keryx] sign-request refused: payTo ${requirements.payTo} is not a known source wallet`,
            );
            return;
          }
        }

        try {
          const { header } = await signPaymentAuthorization(walletClient, requirements);
          // Commit the signed amount BEFORE posting so that a re-entrant sign-request
          // (concurrent sources) sees an accurate total. If the post fails we keep the
          // tracked amount as a conservative over-count (safe — errs toward refusal).
          signedTotalRef.current += amountUsdc;
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
      }).catch((err) => console.error("[keryx] failed to load x402-client-sign:", err));
      return;
    }

    if (event === "done") {
      const run = data as QueryRun;
      setState((s) => ({
        ...s,
        status: "done",
        run,
        // Trust the final run for canonical citations/decisions.
        decisions: run.decisions?.length ? run.decisions : s.decisions,
        citations: run.citations?.length ? run.citations : s.citations,
      }));
      return;
    }

    if (event === "error") {
      const { message } = data as { message: string };
      setState((s) => ({ ...s, status: "error", errorKind: "generic", error: message }));
    }
  // opts is an object reference — destructure the primitive/stable values into the dep array
  // so the hook re-creates handleEvent when the grant activates or the cap changes.
  // knownSourceWallets is a Set: stable after the one-time /api/sources fetch in app/page.tsx.
  }, [opts?.sessionId, opts?.getSessionWalletClient, opts?.grantCap, opts?.knownSourceWallets]);

  const ask = useCallback(
    async (question: string, budget: number) => {
      reset();
      // Reset per-run signed total — each ask() is an independent budget run.
      signedTotalRef.current = 0;
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...INITIAL, status: "streaming", budget });

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            budget,
            // Include session id when a browser co-sign grant is active.
            ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          // Read the error body once (as text), then try JSON — so we can react to a
          // structured session_expired without consuming the stream body twice.
          const bodyText = await res.text().catch(() => "");
          let errCode: string | undefined;
          let errMsg = bodyText;
          let retryAfter: number | null = null;
          try {
            const j = JSON.parse(bodyText) as { error?: string; message?: string; retryAfter?: number };
            errCode = j.error;
            errMsg = j.message ?? j.error ?? bodyText;
            if (typeof j.retryAfter === "number") retryAfter = j.retryAfter;
          } catch { /* not JSON — keep the raw text */ }

          if (res.status === 401 && errCode === "session_expired") {
            // Flip the grant UI to "expired" so the user gets the recover prompt.
            opts?.onSessionExpired?.();
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
            // failure. Surface it as an invitation to connect a wallet (handled by the page).
            setState((s) => ({
              ...s,
              status: "error",
              errorKind: "rate-limit",
              retryAfter,
              error:
                errMsg ||
                "You've used your free dispatches for the moment. Connect a wallet to keep going.",
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
            if (frame) handleEvent(frame.event, frame.data);
          }
        }

        // Flush any trailing frame.
        const tail = parseFrame(buffer);
        if (tail) handleEvent(tail.event, tail.data);

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
        if ((err as Error)?.name === "AbortError") return;
        setState((s) => ({
          ...s,
          status: "error",
          errorKind: "generic",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [handleEvent, reset, opts?.sessionId, opts?.onSessionExpired],
  );

  return { state, ask, reset };
}
