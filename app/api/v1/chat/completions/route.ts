/**
 * OpenAI-compatible chat endpoint — the widest-reach distribution surface for Keryx.
 *
 * Any OpenAI SDK/tool can set base_url to https://keryx.cc/api/v1 and model "keryx"; Keryx runs
 * its full reasoning loop over paid sources and pays every cited creator downstream in USDC on Arc.
 *
 * Auth (via the standard `Authorization: Bearer …` header OpenAI clients already send):
 *  - `kx_live_…` Keryx key → identified caller: higher budget cap, wallet rate-limit, usage metered,
 *    tagged `a2a` (genuine external agent).
 *  - anything else / no key → anonymous free trial: treasury-funded, IP rate-limited, anon budget
 *    cap, tagged `web`. Same guard model as the site's own no-wallet /api/ask path.
 *  Only a token that LOOKS like a Keryx key (`kx_live_…`) but fails verification is rejected — a
 *  placeholder token (e.g. "sk-…", "not-needed") drops to the free tier so drop-in clients work.
 *
 * This path is NOT x402 (OpenAI clients can't sign a payment header); the treasury funds the free
 * tier exactly as the site's anonymous asker does, and creators are still really paid on-chain.
 */

import { isRequestObject } from "@/lib/request-object";
import { NextRequest } from "next/server";
import { collectRun } from "@/lib/agent";
import { resolveModelChoice } from "@/lib/llm";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { verifyApiKey } from "@/lib/api-keys";
import { hasScope, parseScopes } from "@/lib/api-key-scopes";
import { clientIp } from "@/lib/rate-limit";
import { checkSponsoredResearchAdmission } from "@/lib/sponsored-admission";
import {
  type ChatCompletionRequest,
  lastUserQuestion,
  validChatMessages,
  buildCompletion,
  buildAnswerContent,
  buildChunk,
  keryxMeta,
  traceLine,
} from "@/lib/openai-compat";
import type { PaymentOrigin } from "@/lib/types";
import { parseAskQuestion } from "@/lib/ask-input";
import { ResearchPlanningError, researchFailureMessage } from "@/lib/llm/research-plan";
import { ResearchSelectionError } from "@/lib/llm/research-selection";
import type { SelectionDiagnostic } from "@/lib/research/selection-diagnostic";
import { readResearchAvailability } from "@/lib/research/availability";
import { researchAdmissionError } from "@/lib/research/availability-contract";

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
function openaiError(message: string, status: number, code: string, selectionDiagnostic?: SelectionDiagnostic) {
  return Response.json(
    { error: { message, type: "invalid_request_error", code, ...(selectionDiagnostic ? { selectionDiagnostic } : {}) } },
    { status, headers: CORS },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const parsedBody: unknown = await req.json().catch(() => null);
  if (!isRequestObject(parsedBody)) return openaiError("request body must be a JSON object", 400, "invalid_request");
  if (!validChatMessages(parsedBody.messages)) return openaiError("messages must be a non-empty array of message objects with valid content", 400, "invalid_request");
  const body = parsedBody as unknown as ChatCompletionRequest;
  const authHeader = req.headers.get("authorization");
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

  // Default to the anonymous free tier; a valid Keryx key upgrades caps + provenance tag.
  let origin: PaymentOrigin = "web";
  let budgetCap = config.anonMaxBudget;
  let keyIdentity: { walletAddress: string; keyId: string } | undefined;

  if (rawKey?.startsWith("kx_live_")) {
    // The caller intends to authenticate with a Keryx key — hold them to it.
    const keyCtx = await verifyApiKey(rawKey);
    if (!keyCtx) return openaiError("invalid or revoked api key", 401, "invalid_api_key");
    // An export-only key (e.g. one handed to an accountant) must not drive agent runs.
    if (!hasScope(parseScopes(keyCtx.scopes), "ask")) {
      return openaiError("this api key is not scoped for ask", 403, "insufficient_scope");
    }
    keyIdentity = keyCtx;
    origin = "a2a";
    budgetCap = config.a2aMaxBudget;
  }

  if (body.scholarly !== undefined && typeof body.scholarly !== "boolean") return openaiError("scholarly must be a boolean", 400, "invalid_request");
  if (body.mode !== undefined && body.mode !== "quick" && body.mode !== "deep") return openaiError("mode must be quick or deep", 400, "invalid_request");
  const parsedQuestion = parseAskQuestion(lastUserQuestion(body.messages));
  if (!parsedQuestion.success) {
    return openaiError(parsedQuestion.error, 400, "invalid_request");
  }
  const question = parsedQuestion.question;
  const availability = readResearchAvailability();
  if (availability.state === "paused") return openaiError(availability.message, 503, "research_paused");

  // Model routing: "keryx" (default) or "keryx:<catalog-id>" (see GET /v1/models) runs the agent
  // with that reasoning model. Unknown/unconfigured ids run the default — never a client error —
  // and any pick that fails mid-run crosses configured providers, then the offline heuristic.
  const modelChoice = resolveModelChoice(body.model);
  const modelName = modelChoice ? `keryx:${modelChoice.id}` : MODEL;

  if (!config.sellerAddress) {
    return openaiError("treasury wallet not configured", 500, "server_error");
  }

  const limited = await checkSponsoredResearchAdmission(keyIdentity
    ? { kind: "key", wallet: keyIdentity.walletAddress, ip: clientIp(req) }
    : { kind: "anonymous", ip: clientIp(req) });
  if (limited) {
    const headers = new Headers(limited.headers);
    for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
    return new Response(limited.body, { status: limited.status, headers });
  }
  if (keyIdentity) {
    const db = await getDb();
    void db.incrementUsage(keyIdentity.keyId);
  }

  // Keryx's own headless drivers pass the shared bot key so their self-generated calls are tagged
  // `engine` (self-volume), keeping the external bucket honest.
  const isBot = !!config.botKey && req.nextUrl.searchParams.get("bot") === config.botKey;
  if (isBot) origin = "engine";

  // Budget: a caller may pass a Keryx `budget` extension (extra_body); coerce + clamp to the cap
  // for this tier. Missing/invalid → default budget, still clamped.
  const requested =
    typeof body.budget === "number" && Number.isFinite(body.budget) && body.budget >= 0
      ? body.budget
      : config.defaultBudget;
  const budget = Math.min(requested, budgetCap);

  const queryId = crypto.randomUUID();

  // ── Non-streaming: run to completion, return one ChatCompletion object. ──
  if (!body.stream) {
    try {
      const run = await collectRun({ question, budget, queryId, origin, model: modelChoice?.id, scholarly: body.scholarly === true, researchMode: body.mode ?? "deep", ...(keyIdentity ? { asker: keyIdentity.walletAddress } : {}),
        provenance: { version: 1, surface: "api", ownershipMethod: keyIdentity ? "api-key" : "unknown" } });
      return Response.json(buildCompletion(run, modelName), { headers: CORS });
    } catch (error) {
      const held = researchAdmissionError(error);
      if (held) return openaiError(held.message, 503, held.code);
      if (!(error instanceof ResearchPlanningError) && !(error instanceof ResearchSelectionError)) throw error;
      return openaiError(researchFailureMessage(error), error.status, error.code,
        error instanceof ResearchSelectionError ? error.diagnostic : undefined);
    }
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
          { question, budget, queryId, origin, model: modelChoice?.id, scholarly: body.scholarly === true, researchMode: body.mode ?? "deep", ...(keyIdentity ? { asker: keyIdentity.walletAddress } : {}),
            provenance: { version: 1, surface: "api", ownershipMethod: keyIdentity ? "api-key" : "unknown" } },
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
            content: `\n\n[keryx error] ${researchFailureMessage(err)}`,
          }, null, researchAdmissionError(err)
            ? { keryx_error: { code: "research_paused" } }
            : err instanceof ResearchSelectionError ? { keryx_error: { code: err.code, selectionDiagnostic: err.diagnostic } } : undefined),
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
