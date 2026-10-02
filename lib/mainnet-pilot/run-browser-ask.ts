import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runAgent } from "../agent/run-agent";
import type { ResearchEffects } from "../agent/research-effects";
import { buildDecisionContext, saveMemory } from "../agent/query-memory";
import { BrowserCoSignGateway } from "../payments/browser-cosign-gateway";
import { assertPilotServerContext, type PilotServerContext } from "./server-context";
import { readPilotJson } from "./read-json";

const bodySchema = z.object({ question: z.string().trim().min(1).max(4000), budgetUsd: z.number().positive().finite() }).strict();
/** Explicit owner comes only from a verified server session, never an HTTP wallet claim. */
export async function runPilotBrowserAsk(request: Request, context: PilotServerContext, owner: string): Promise<Response> {
  try {
    assertPilotServerContext(context);
    if (new URL(request.url).origin !== context.policy.origin || request.headers.get("origin") !== context.policy.origin || request.method !== "POST")
      return Response.json({ error: "pilot_origin_refused" }, { status: 403 });
    const input = bodySchema.parse(await readPilotJson(request));
    const grant = await context.getGrant(owner);
    const micros = Math.round(input.budgetUsd * 1e6);
    if (!grant || !Number.isSafeInteger(micros) || Math.abs(input.budgetUsd * 1e6 - micros) > 0.000001 ||
        micros <= 0 || micros > context.policy.limits.perAskMicros)
      return Response.json({ error: "pilot_session_refused" }, { status: 403 });
    const queryId = randomUUID();
    if (!context.admissions.admitQuery(queryId, owner, grant.sessAddr.toLowerCase(), grant.grantEpoch, micros))
      return Response.json({ error: "pilot_capacity_refused" }, { status: 402 });
    const abort = new AbortController();
    const cancel = () => abort.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) abort.abort();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { abort.abort(); }
        };
        const db = context.db;
        const effects: ResearchEffects = { scope: { kind: "job", queryId },
          recordPayment: payment => db.recordPayment(payment), getCached: key => db.getCached(key), getCachedAt: key => db.getCachedAt(key),
          setCached: (key, value) => db.setCached(key, value), saveQueryRun: run => db.saveQueryRun(run),
          discoverExternal: async () => [], decisionContext: (question, candidates) => buildDecisionContext(db, question, candidates),
          saveMemory: (id, question, citations, read) => saveMemory(db, id, question, citations, read),
          notifyCitation() {}, alert() {}, activation: async () => {} };
        const gateway = new BrowserCoSignGateway(owner, grant.sessAddr,
          context.signatures.awaitHeader(context, owner, grant.sessAddr.toLowerCase(), grant.grantEpoch, abort.signal, send),
          abort.signal, grant.grantEpoch, context.gatewayContext);
        try {
          send("meta", { engine: context.engine.name, mode: "synthetic", network: "eip155:5042", enrollmentDigest: context.enrollmentDigest });
          const gen = runAgent({ question: input.question, budget: micros / 1e6, queryId, signal: abort.signal,
            researchMode: "quick", scholarly: false, paidScholarly: false, allowExternalWeb: false,
            origin: "web", asker: owner, fundingOwner: "browser", executionLimits: { attentionLimit: 5, reevaluateRounds: 0 } },
          { db, engine: context.engine, gateway, effects, sourceFetchTerms: context.sourceAuthority.terms });
          for (;;) {
            const step = await gen.next();
            if (step.done) {
              for (const sourceId of context.unavailableSources()) send("source-unavailable", { sourceId, reason: "registry-authority-unavailable" });
              send("done", step.value); break;
            }
            send("step", step.value);
            if (abort.signal.aborted) { await gen.return(undefined as never); break; }
          }
        } catch { send("error", { message: "Pilot dispatch unavailable; retained authorizations require reconciliation." }); }
        finally { request.signal.removeEventListener("abort", cancel); try { controller.close(); } catch {} }
      },
      cancel,
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no", Connection: "keep-alive" } });
  } catch { return Response.json({ error: "pilot_request_refused" }, { status: 400 }); }
}
