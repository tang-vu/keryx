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

export interface AskStreamState {
  status: "idle" | "streaming" | "done" | "error";
  meta: AskMeta | null;
  steps: TraceStep[];
  decisions: Decision[];
  citations: Citation[];
  payments: PaymentRecord[];
  run: QueryRun | null;
  error: string | null;
}

const INITIAL: AskStreamState = {
  status: "idle",
  meta: null,
  steps: [],
  decisions: [],
  citations: [],
  payments: [],
  run: null,
  error: null,
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
}

export function useAskStream(opts?: AskStreamOpts) {
  const [state, setState] = useState<AskStreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

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
      const { reqId, requirements } = data as {
        reqId: string;
        requirements: PaymentRequirementsInput;
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
        try {
          const { header } = await signPaymentAuthorization(walletClient, requirements);
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
      setState((s) => ({ ...s, status: "error", error: message }));
    }
  }, [opts?.sessionId, opts?.getSessionWalletClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = useCallback(
    async (question: string, budget: number) => {
      reset();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...INITIAL, status: "streaming" });

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
          const msg = await res.text().catch(() => "Request failed");
          setState((s) => ({ ...s, status: "error", error: msg || `HTTP ${res.status}` }));
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

        setState((s) =>
          s.status === "streaming" ? { ...s, status: "done" } : s,
        );
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [handleEvent, reset],
  );

  return { state, ask, reset };
}
