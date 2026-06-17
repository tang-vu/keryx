/**
 * Streaming agent endpoint. POST { question, budget, sessionId? } → Server-Sent Events:
 *   event: meta         → { engine, mode } once at start
 *   event: step         → each TraceStep as the agent reasons/pays
 *   event: sign-request → { reqId, requirements } when browser co-sign is active
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

import { NextRequest } from "next/server";
import { getAgentDeps } from "@/lib/agent";
import { runAgent } from "@/lib/agent/run-agent";
import { awaitSignature, isGrantValid } from "@/lib/payments/session-grants";
import type { PaymentRequirements } from "@/lib/payments/browser-cosign-gateway";
import type { QueryRun } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    question?: string;
    budget?: number;
    sessionId?: string;
  };
  const question = (body.question ?? "").trim();
  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  // Optional browser co-sign session. Normalise to lowercase to match grant keys.
  const sessionId = body.sessionId ? body.sessionId.toLowerCase() : undefined;
  const useBrowserCoSign = Boolean(sessionId && isGrantValid(sessionId));

  const encoder = new TextEncoder();

  // AbortController tied to the client connection so sign-request promises are
  // cancelled when the browser disconnects mid-run.
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Controller already closed (client disconnected) — ignore.
        }
      };

      try {
        let deps;

        if (useBrowserCoSign && sessionId) {
          // Build the requestSignature callback that the BrowserCoSignGateway calls for each BUY.
          // It emits an SSE sign-request event and suspends until /api/ask/sign resolves it.
          const requestSignature = (reqId: string, requirements: PaymentRequirements): Promise<string> => {
            send("sign-request", { reqId, requirements });
            return awaitSignature(reqId);
          };

          deps = await getAgentDeps({
            gatewayOpts: {
              sessionId,
              requestSignature,
              abortSignal: abort.signal,
            },
          });
        } else {
          deps = await getAgentDeps();
        }

        send("meta", { engine: deps.engine.name, mode: deps.gateway.mode });
        const gen = runAgent({ question, budget: body.budget }, deps);
        let res = await gen.next();
        while (!res.done) {
          send("step", res.value);
          res = await gen.next();
          if (abort.signal.aborted) break;
        }
        // When the generator is done (res.done === true), res.value is QueryRun.
        // If we broke early due to abort, skip saving — the run is incomplete.
        if (res.done) {
          const run = res.value as QueryRun;
          await deps.db.saveQueryRun(run);
          send("done", run);
        }
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
