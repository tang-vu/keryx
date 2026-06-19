/**
 * Agent-to-Agent (A2A) endpoint. Another agent PAYS Keryx (x402, fee → treasury) to answer a
 * question; Keryx then runs its full reasoning loop and pays the creators it cites downstream.
 * A recursive citation economy: Keryx is both payee (from the caller) and payer (to creators).
 *
 * POST /api/agent/ask  body { question, budget? }  (x402-protected)
 */

import { NextRequest } from "next/server";
import { collectRun } from "@/lib/agent";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { makePayment } from "@/lib/payments/payment-gateway";
import { settleThenServe } from "@/lib/x402-server";
import { verifyApiKey } from "@/lib/api-keys";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // ── API key pre-check (additive; x402 settleThenServe below is unchanged) ──
  // If an Authorization: Bearer kx_live_… header is present, the caller has identified
  // themselves via a wallet-issued key. Rate-limit and meter by key id.
  // The key does NOT bypass x402 — payment-signature is still required below.
  const authHeader = req.headers.get("authorization");
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (rawKey) {
    const limited = await checkRateLimit(rawKey, "ask");
    if (limited) return limited;

    const keyCtx = await verifyApiKey(rawKey);
    if (!keyCtx) return Response.json({ error: "invalid or revoked api key" }, { status: 401 });

    // Fire-and-forget daily usage counter — does not block the response.
    const db = await getDb();
    void db.incrementUsage(keyCtx.keyId);
  }
  // ── End key pre-check ──

  const body = (await req.json().catch(() => ({}))) as { question?: string; budget?: number };
  const question = (body.question ?? "").trim();
  if (!question) return Response.json({ error: "question is required" }, { status: 400 });
  const treasury = config.sellerAddress;
  if (!treasury) return Response.json({ error: "treasury wallet not configured" }, { status: 500 });

  const queryId = crypto.randomUUID();

  return settleThenServe(
    req,
    {
      priceUsdc: config.a2aFeeUsdc,
      payTo: treasury,
      endpoint: "/api/agent/ask",
      description: "Keryx autonomous research — answer with citations; creators paid downstream",
    },
    async (settle) => {
      const db = await getDb();
      // Record the inbound A2A fee (revenue), kept separate from creator payouts in metrics.
      await db.recordPayment(
        makePayment({
          kind: "inbound",
          queryId,
          sourceId: "a2a",
          sourceName: "A2A caller",
          payer: settle.payer,
          payee: treasury,
          amountUsdc: settle.amountUsdc,
          txHash: settle.transaction,
          settled: true,
          origin: "a2a",
          rationale: "Inbound agent-to-agent research fee.",
        }),
      );
      // Run the full agent — it autonomously pays the creators it cites. origin "a2a" marks the
      // downstream citation payouts as external (driven by a real outside agent, not the engine).
      const run = await collectRun({ question, budget: body.budget, queryId, origin: "a2a" });
      return {
        queryId: run.id,
        answer: run.answer,
        citations: run.citations.map((c) => ({
          source: c.sourceName,
          weight: c.weight,
          reward: c.reward,
        })),
        creatorsPaid: run.citations.length,
        totalToCreators: run.totalToCreators,
        feePaid: settle.amountUsdc,
        engine: run.engine,
      };
    },
  );
}
