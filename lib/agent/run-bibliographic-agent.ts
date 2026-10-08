import type { AgentDeps } from "./deps";
import type { RunInput } from "./run-agent";
import type { BibliographicTask } from "../research/bibliographic-task-request";
import { readBibliographicTask } from "../research/bibliographic-task";
import { bibliographicTaskAnswer } from "../research/bibliographic-task-presentation";
import type { QueryRun, TracePhase, TraceStep } from "../types";
import { newRunProvenance } from "../research/run-provenance";

/** Public metadata-only delivery. No engine, gateway, cache, reward or catalog
 * method is called; normal request admission/persistence remains with its caller. */
export async function* runBibliographicAgent(input: RunInput, deps: AgentDeps, task: BibliographicTask): AsyncGenerator<TraceStep, QueryRun, void> {
  const startedAt = Date.now(), trace: TraceStep[] = [];
  const emit = (phase: TracePhase, message: string, detail?: unknown): TraceStep => {
    const step = { phase, message, ...(detail === undefined ? {} : { detail }), ts: Date.now() };
    trace.push(step); return step;
  };
  input.signal?.throwIfAborted();
  yield emit("decompose", "The caller requested an exact bibliographic record. Read original metadata without a model request, source toll or creator reward.",
    { scope: task.request.scope, target: task.request.target, fields: task.requestedFields, language: task.request.language });
  yield emit("fetch", "READ the exact original metadata once; scientific full-text evidence is outside this task.");
  const bibliography = await readBibliographicTask(task, { reader: deps.readBibliographicOriginal, signal: input.signal });
  input.signal?.throwIfAborted();
  const answer = bibliographicTaskAnswer(bibliography);
  yield emit("synthesize", bibliography.record.failure ? "Retained the original metadata read gap; no alternate paper, model request or payment retry." : "Delivered observed original metadata with explicit field gaps and separate bibliography exports.");
  yield emit("done", "Bibliography completed. Source tolls and creator rewards: 0 USDC. No scientific claim coverage was assessed.");
  return {
    id: input.queryId!, question: input.question, budget: input.budget ?? 0,
    researchMode: input.researchMode ?? "deep", engine: "metadata:original-page", subClaims: [], decisions: [], citations: [],
    answer, bibliography, totalSpent: 0, totalToCreators: 0, trace, createdAt: new Date().toISOString(),
    reasoningAttempts: [], llmUsage: [], llmCalls: [], origin: input.origin ?? "engine",
    provenance: newRunProvenance(input),
    ...(input.origin === "mcp" && input.mcpClient ? { mcpClient: input.mcpClient } : {}),
    ...(input.asker ? { asker: input.asker.toLowerCase() } : {}),
    ...(input.retryOf ? { retryOf: input.retryOf } : {}),
    fundingOwner: deps.gateway.mode === "offline" ? "offline" : (input.fundingOwner ?? "treasury"),
    paymentMode: deps.gateway.mode, paymentAttempts: 0, settledPayments: 0, pendingPayments: 0, pendingSpendUsdc: 0,
    durationMs: Math.max(0, Date.now() - startedAt),
    confidence: { level: "Low", reason: "Bibliographic observations only; scientific claim support was not assessed." },
  };
}
