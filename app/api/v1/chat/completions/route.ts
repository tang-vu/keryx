/**
 * OpenAI-compatible chat endpoint — the widest-reach distribution surface for Keryx.
 *
 * Any OpenAI SDK/tool can set base_url to https://keryx.cc/api/v1 and model "keryx"; Keryx runs
 * its full reasoning loop over paid sources and pays every cited creator downstream in USDC on Arc.
 *
 * Auth (via the standard `Authorization: Bearer …` header OpenAI clients already send):
 *  - `kx_live_…` Keryx key → identified caller: higher budget cap, key rate-limit, usage metered,
 *    tagged `a2a` (genuine external agent).
 *  - anything else / no key → anonymous free trial: treasury-funded, IP rate-limited, anon budget
 *    cap, tagged `web`. Same guard model as the site's own no-wallet /api/ask path.
 *  Only a token that LOOKS like a Keryx key (`kx_live_…`) but fails verification is rejected — a
 *  placeholder token (e.g. "sk-…", "not-needed") drops to the free tier so drop-in clients work.
 *
 * This path is NOT x402 (OpenAI clients can't sign a payment header); the treasury funds the free
 * tier exactly as the site's anonymous asker does, and creators are still really paid on-chain.
 */

import { NextRequest } from "next/server";
import { collectRun } from "@/lib/agent";
import { resolveModelChoice } from "@/lib/llm";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { verifyApiKey } from "@/lib/api-keys";
import { hasScope, parseScopes } from "@/lib/api-key-scopes";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  type ChatCompletionRequest,
  lastUserQuestion,
  buildCompletion,
  buildAnswerContent,
  buildChunk,
  keryxMeta,
  traceLine,
} from "@/lib/openai-compat";
import type { PaymentOrigin } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "keryx";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** OpenAI-shaped error envelope so client SDKs surface a readable message. */
function openaiError(message: string, status: number, code: string) {
  return Response.json(
    { error: { message, type: "invalid_request_error", code } },
    { status, headers: CORS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

  // Default to the anonymous free tier; a valid Keryx key upgrades caps + provenance tag.
  let origin: PaymentOrigin = "web";
  let budgetCap = config.anonMaxBudget;

  if (rawKey?.startsWith("kx_live_")) {
    // The caller intends to authenticate with a Keryx key — hold them to it.
    const limited = await checkRateLimit(rawKey, "ask");
    if (limited) return limited;
    const keyCtx = await verifyApiKey(rawKey);
    if (!keyCtx) return openaiError("invalid or revoked api key", 401, "invalid_api_key");
    // An export-only key (e.g. one handed to an accountant) must not drive agent runs.
    if (!hasScope(parseScopes(keyCtx.scopes), "ask")) {
      return openaiError("this api key is not scoped for ask", 403, "insufficient_scope");
    }
    const db = await getDb();
    void db.incrementUsage(keyCtx.keyId); // fire-and-forget daily counter
    origin = "a2a";
    budgetCap = config.a2aMaxBudget;
  } else {
    // Anonymous free trial — treasury-funded, so IP rate-limit against scripted drain / fake volume.
    const limited = await checkRateLimit(clientIp(req), "treasuryAsk", {
      code: "free_trial_limit",
      message:
        "Free dispatches are rate-limited. Pass a kx_live_ API key as the Bearer token for higher limits.",
    });
    if (limited) return limited;
  }

  const body = (await req.json().catch(() => ({}))) as ChatCompletionRequest;
  const question = lastUserQuestion(body.messages);
  if (!question) return openaiError("no user message with content", 400, "invalid_request");

  // Model routing: "keryx" (default) or "keryx:<catalog-id>" (see GET /v1/models) runs the agent
  // with that reasoning model. Unknown/unconfigured ids run the default — never a client error —
  // and any pick that fails mid-run falls back to DeepSeek, then the offline heuristic.
  const modelChoice = resolveModelChoice(body.model);
  const modelName = modelChoice ? `keryx:${modelChoice.id}` : MODEL;

  if (!config.sellerAddress) {
    return openaiError("treasury wallet not configured", 500, "server_error");
  }

  // Keryx's own headless drivers pass the shared bot key so their self-generated calls are tagged
  // `engine` (self-volume), keeping the external bucket honest.
  const isBot = !!config.botKey && req.nextUrl.searchParams.get("bot") === config.botKey;
  if (isBot) origin = "engine";

  // Budget: a caller may pass a Keryx `budget` extension (extra_body); coerce + clamp to the cap
  // for this tier. Missing/invalid → default budget, still clamped.
  const requested =
    typeof body.budget === "number" && Number.isFinite(body.budget) && body.budget > 0
      ? body.budget
      : config.defaultBudget;
  const budget = Math.min(requested, budgetCap);

  const queryId = crypto.randomUUID();

  // ── Non-streaming: run to completion, return one ChatCompletion object. ──
  if (!body.stream) {
    const run = await collectRun({ question, budget, queryId, origin, model: modelChoice?.id });
    return Response.json(buildCompletion(run, modelName), { headers: CORS });
  }

  // ── Streaming: emit reasoning live as `reasoning_content`, then the answer as `content`. ──
  const encoder = new TextEncoder();
  const id = `chatcmpl-${queryId}`;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // Controller closed (client disconnected) — stop enqueueing.
        }
      };
      try {
        send(buildChunk(id, modelName, { role: "assistant" }));
        // Stream each trace step as an o1-style reasoning delta. Clients that don't support
        // reasoning_content ignore it and still receive the answer content below.
        const run = await collectRun(
          { question, budget, queryId, origin, model: modelChoice?.id },
          { onStep: (s) => send(buildChunk(id, modelName, { reasoning_content: traceLine(s) })) },
        );
        send(buildChunk(id, modelName, { content: buildAnswerContent(run) }));
        send(buildChunk(id, modelName, {}, "stop", { keryx: keryxMeta(run) }));
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch {
          // Client disconnected before the terminator — nothing to flush.
        }
      } catch (err) {
        send(
          buildChunk(id, modelName, {
            content: `\n\n[keryx error] ${err instanceof Error ? err.message : String(err)}`,
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
