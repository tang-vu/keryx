/**
 * Streaming agent endpoint. POST { question, budget } → Server-Sent Events:
 *   event: step  → each TraceStep as the agent reasons/pays
 *   event: done  → the final QueryRun
 *   event: error → failure
 */

import { NextRequest } from "next/server";
import { getAgentDeps } from "@/lib/agent";
import { runAgent } from "@/lib/agent/run-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    question?: string;
    budget?: number;
  };
  const question = (body.question ?? "").trim();
  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      try {
        const deps = await getAgentDeps();
        send("meta", { engine: deps.engine.name, mode: deps.gateway.mode });
        const gen = runAgent({ question, budget: body.budget }, deps);
        let res = await gen.next();
        while (!res.done) {
          send("step", res.value);
          res = await gen.next();
        }
        const run = res.value;
        await deps.db.saveQueryRun(run);
        send("done", run);
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
