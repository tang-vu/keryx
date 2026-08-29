/**
 * Streaming agent endpoint. POST { question, budget, sessionId? } → Server-Sent Events:
 *   event: meta         → { engine, mode } once at start
 *   event: step         → each TraceStep as the agent reasons/pays
 *   event: sign-request → { reqId, requirements, kind, sourceId } when browser co-sign is active
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
import { getSession } from "@/lib/auth";
import { getAgentDeps } from "@/lib/agent";
import { runAgent } from "@/lib/agent/run-agent";
import { config } from "@/lib/config";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { getDb } from "@/lib/db";
import { buildFollowUpQuestion } from "@/lib/agent/follow-up-question";
import { getGrant } from "@/lib/payments/session-grants";
import { awaitSignature } from "@/lib/payments/pending-signatures";
import type {
  BrowserPaymentContext,
  PaymentRequirements,
} from "@/lib/payments/browser-cosign-gateway";
import type { QueryRun, ResearchMode } from "@/lib/types";
import { MAX_ASK_QUESTION_CHARS, parseAskQuestion, parseResearchMode } from "@/lib/ask-input";
import { recordActivationEvent } from "@/lib/activation";
import { isAddress } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    question?: unknown;
    budget?: unknown;
    sessionId?: unknown;
    parentId?: unknown;
    model?: unknown;
    mode?: unknown;
  };
  // Model pick from the UI's picker. Validated inside getAgentDeps → resolveModelChoice:
  // unknown/unconfigured ids silently run the default engine, and every pick has a
  // Configured-provider → heuristic fallback chain, so a crafted value can never fail an ask.
  const model =
    typeof body.model === "string" ? body.model.trim().slice(0, 64) || undefined : undefined;
  const parsedQuestion = parseAskQuestion(body.question);
  if (!parsedQuestion.success) {
    return Response.json({ error: parsedQuestion.error }, { status: 400 });
  }
  const question = parsedQuestion.question;
  const researchMode: ResearchMode = parseResearchMode(body.mode);

  // A present session id means "spend my browser-funded grant". Never coerce a malformed value or
  // silently reinterpret an empty one as the anonymous treasury path.
  let sessionId: string | undefined;
  if (body.sessionId !== undefined) {
    if (typeof body.sessionId !== "string" || !isAddress(body.sessionId.trim())) {
      return Response.json({ error: "sessionId must be a valid wallet address" }, { status: 400 });
    }
    sessionId = body.sessionId.trim().toLowerCase();
  }

  // Follow-up: anchor the question to its parent so "how does that compare?" is answerable. Only
  // the parent *question* is carried — never its answer, which sources were paid to produce. An
  // unknown parent id degrades to a standalone ask rather than failing the dispatch.
  let parentId: string | undefined;
  let askQuestion = question;
  const requestedParentId =
    typeof body.parentId === "string" && body.parentId.trim() ? body.parentId.trim() : undefined;
  if (requestedParentId) {
    const parent = await (await getDb()).getQueryRun(requestedParentId);
    if (parent) {
      parentId = parent.id;
      // Historical rows predate the input bound. Keep one old dispatch from expanding a new model
      // prompt without limit while preserving enough context for a useful follow-up.
      askQuestion = buildFollowUpQuestion(
        parent.question.slice(0, MAX_ASK_QUESTION_CHARS),
        question,
      );
    }
  }

  // Who gets this dispatch in their ledger. Read from the SIWE cookie — the one wallet claim the
  // server has actually verified — and read HERE, in request scope: the stream body below runs
  // after the handler returns, where cookies() is no longer available. A signed-out ask stays
  // unattributed rather than borrowing `sessionId`, which is client-supplied.
  const asker = (await getSession())?.address?.toLowerCase();

  // A session id is a public wallet address, not a bearer secret. Bind the browser co-sign path to
  // the SIWE identity that created the grant before exempting it from the treasury rate limit or
  // exposing sign-request ids. Otherwise another caller could reserve a known wallet's cap with
  // bogus headers and use that victim session as an unmetered LLM front door.
  if (sessionId && !asker) {
    return Response.json(
      {
        error: "session_auth_required",
        message: "Sign in with the wallet that created this spending session.",
      },
      { status: 401 },
    );
  }
  if (sessionId && asker !== sessionId) {
    return Response.json(
      {
        error: "session_owner_mismatch",
        message: "This spending session belongs to a different wallet.",
      },
      { status: 403 },
    );
  }

  // If the client presents a session but the server grant is gone (TTL lapsed, or the user
  // revoked it), do NOT silently fall back to the treasury gateway — that would spend Keryx's
  // own USDC for a user who meant to spend their own. Tell the client to recover (re-derive the
  // key + re-register the grant against the live Gateway balance). Grants now survive a restart,
  // so a deploy no longer lands here. A request with NO sessionId is the legitimate
  // anonymous/treasury path and is left untouched.
  const grant = sessionId ? await getGrant(sessionId) : undefined;
  if (sessionId && (!grant || grant.ownerAddr.toLowerCase() !== asker)) {
    return Response.json(
      {
        error: "session_expired",
        message: "Your spending session expired — recover it to continue.",
      },
      { status: 401 },
    );
  }
  const useBrowserCoSign = Boolean(sessionId);

  // Anonymous requests are IP-limited against treasury drain. Browser co-sign payments are
  // grant-funded, but their model/search compute is separately limited by verified owner wallet.
  if (useBrowserCoSign && sessionId) {
    const limited = await checkRateLimit(sessionId, "sessionAsk", {
      code: "session_rate_limit",
      message: "This wallet has dispatched several questions recently. Try again shortly.",
    });
    if (limited) return limited;
  } else {
    const limited = await checkRateLimit(clientIp(req), "treasuryAsk", {
      code: "free_trial_limit",
      message:
        "You've used your free dispatches for the moment. Connect a wallet to keep going on your own budget — or try again shortly.",
    });
    if (limited) return limited;
  }

  const coercedBudget =
    typeof body.budget === "number" && Number.isFinite(body.budget) && body.budget > 0
      ? body.budget
      : config.defaultBudget;
  const remainingGrantUsdc = grant
    ? Math.max(
        0,
        Math.round(grant.cap * 1_000_000) - Math.round(grant.spent * 1_000_000),
      ) / 1_000_000
    : undefined;
  if (useBrowserCoSign && (!remainingGrantUsdc || remainingGrantUsdc <= 0)) {
    return Response.json(
      {
        error: "session_budget_exhausted",
        message: "This spending session has no unreserved USDC left.",
      },
      { status: 402 },
    );
  }
  const askBudget = useBrowserCoSign
    ? Math.min(coercedBudget, remainingGrantUsdc!, config.sessionAskMaxBudget)
    : Math.min(coercedBudget, config.anonMaxBudget);

  const isBot = !!config.botKey && req.nextUrl.searchParams.get("bot") === config.botKey;
  if (!isBot) {
    await recordActivationEvent(await getDb(), "reader_ask_started");
  }

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
          // It emits the payment requirements plus article/offer proof in an SSE sign-request
          // event and suspends until /api/ask/sign resolves it.
          // sessionId is narrowed (non-null) by the useBrowserCoSign guard above.
          const capturedSessionId = sessionId;
          const requestSignature = (
            reqId: string,
            requirements: PaymentRequirements,
            kind: "fetch" | "citation",
            sourceId: string,
            paymentContext?: BrowserPaymentContext,
          ): Promise<string> => {
            send("sign-request", { reqId, requirements, kind, sourceId, paymentContext });
            // Scope the pending slot to this session so a caller can't resolve another session's sign-request.
            return awaitSignature(capturedSessionId, reqId, abort.signal);
          };

          deps = await getAgentDeps({
            gatewayOpts: {
              sessionId,
              requestSignature,
              abortSignal: abort.signal,
            },
            model,
          });
        } else {
          deps = await getAgentDeps({ model });
        }

        send("meta", { engine: deps.engine.name, mode: deps.gateway.mode, researchMode });
        // A request through /api/ask is a genuine human on the site → tag as external "web" usage
        // (the volume engine never goes through this route; it calls collectRun directly).
        // Exception: Keryx's own headless web-client drives this same route 24/7 and passes the
        // shared bot key, so its self-generated volume is tagged `engine` — the external bucket
        // then counts only genuine third-party askers.
        const gen = runAgent(
          {
            question: askQuestion,
            budget: askBudget,
            researchMode,
            origin: isBot ? "engine" : "web",
            fundingOwner: useBrowserCoSign ? "browser" : "treasury",
          },
          deps,
        );
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
          let isReturning = false;
          if (!isBot && asker) {
            try {
              isReturning = (await deps.db.listQueryRunsByAsker(asker, 1)).length > 0;
            } catch {
              // Funnel classification is best-effort and must not strand a completed paid answer.
            }
          }
          if (parentId) run.parentId = parentId;
          if (asker) {
            run.asker = asker;
            // Only the co-sign path spends the asker's own funded session. A free-trial dispatch
            // by a signed-in wallet is still theirs to look back at, but the USDC was Keryx's —
            // never let it total up as the user's spend.
            run.askerFunded = useBrowserCoSign;
          }
          await deps.db.saveQueryRun(run);
          if (!isBot) {
            await recordActivationEvent(deps.db, "reader_answer_completed");
            if (isReturning) {
              await recordActivationEvent(deps.db, "reader_returning_dispatch");
            }
          }
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
      // Disable proxy response buffering so the live reasoning trace streams token-by-token
      // instead of arriving in one batch at the end. Honored by nginx and by the Cloudflare
      // edge in front of keryx.cc; without it a buffering proxy makes the trace look frozen.
      "X-Accel-Buffering": "no",
    },
  });
}
