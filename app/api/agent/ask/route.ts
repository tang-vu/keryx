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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
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
          rationale: "Inbound agent-to-agent research fee.",
        }),
      );
      // Run the full agent — it autonomously pays the creators it cites.
      const run = await collectRun({ question, budget: body.budget, queryId });
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
