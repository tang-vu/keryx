/**
 * OpenAI Chat Completions ↔ Keryx mappers (pure, side-effect free).
 *
 * These let any OpenAI-compatible SDK/tool (LangChain, LlamaIndex, OpenWebUI, LibreChat, …)
 * point base_url at https://keryx.cc/api/v1 and ask Keryx a question. The client speaks the
 * OpenAI wire format; Keryx runs its full reasoning loop and pays every cited creator downstream.
 *
 * The route (app/api/v1/chat/completions) owns auth, rate-limit, budget clamp, and the agent run;
 * this module only translates shapes so both stay small and the translation stays unit-testable.
 */

import { config } from "./config";
import type { QueryRun, TraceStep } from "./types";

/** One OpenAI content part (vision-style array form) — only text parts carry a question. */
interface ContentPart {
  type?: string;
  text?: string;
}

export interface ChatMessage {
  role: string;
  content: string | ContentPart[] | null;
}

/** Incoming OpenAI request body. `budget` is a Keryx extension (passed via extra_body); OpenAI
 *  clients that don't know it simply omit it and the route applies its per-path default + cap. */
export interface ChatCompletionRequest {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  budget?: number;
}

/** Flatten a message's content to plain text (handles the string form and the vision array form). */
function contentText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

/**
 * The question to research = the LAST user message (what the client is asking now). Falls back to
 * the last message of any role, so a client that mislabels roles still works. Prior turns are not
 * replayed — Keryx answers the current ask from paid sources, not from conversation memory.
 */
export function lastUserQuestion(messages: ChatMessage[] | undefined): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      const t = contentText(messages[i]!.content);
      if (t) return t;
    }
  }
  // No usable user turn — fall back to the last non-empty message of any role.
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = contentText(messages[i]!.content);
    if (t) return t;
  }
  return "";
}

/** Structured Keryx settlement summary, attached as a vendor extension on every response. */
export function keryxMeta(run: QueryRun) {
  return {
    queryId: run.id,
    citations: run.citations.map((c) => ({
      source: c.sourceName,
      weight: c.weight,
      reward: c.reward,
    })),
    creatorsPaid: run.citations.length,
    totalToCreators: run.totalToCreators,
    engine: run.engine,
    dispatchUrl: `${config.baseUrl}/dispatch/${run.id}`,
  };
}

/** Markdown footer listing the creators Keryx paid — so even a client that renders only `content`
 *  (not the vendor extension) surfaces the citation economy. Empty when nothing was cited. */
function citationsFooter(run: QueryRun): string {
  if (run.citations.length === 0) return "";
  const lines = run.citations.map(
    (c) => `- ${c.sourceName} — $${c.reward.toFixed(4)} (weight ${c.weight.toFixed(2)})`,
  );
  return (
    `\n\n---\n**Creators paid** — weighted USDC citation rewards on Arc testnet:\n` +
    lines.join("\n") +
    `\n\nTotal to creators: $${run.totalToCreators.toFixed(4)} · ` +
    `dispatch: ${config.baseUrl}/dispatch/${run.id}`
  );
}

/** Assistant message body = the grounded answer plus the creators-paid footer. */
export function buildAnswerContent(run: QueryRun): string {
  return run.answer + citationsFooter(run);
}

/** A complete (non-streamed) OpenAI ChatCompletion object. */
export function buildCompletion(run: QueryRun, model: string) {
  return {
    id: `chatcmpl-${run.id}`,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: buildAnswerContent(run) },
        finish_reason: "stop" as const,
      },
    ],
    // Keryx does not meter tokens (it meters USDC to creators), so usage is reported as zero.
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    keryx: keryxMeta(run),
  };
}

type Delta = {
  role?: "assistant";
  content?: string;
  reasoning_content?: string;
};

/** A single OpenAI chat.completion.chunk (streaming). `extra` carries the final vendor summary. */
export function buildChunk(
  id: string,
  model: string,
  delta: Delta,
  finishReason: "stop" | null = null,
  extra?: Record<string, unknown>,
) {
  return {
    id,
    object: "chat.completion.chunk" as const,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  };
}

/** One trace step as an o1-style reasoning line — streamed via `delta.reasoning_content` so
 *  clients that support it show Keryx's live buy/skip/trust decisions without polluting the answer. */
export function traceLine(step: TraceStep): string {
  return `[${step.phase}] ${step.message}\n`;
}
