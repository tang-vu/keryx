/**
 * A2A Paid Research v2. The caller prepays a fixed all-in testnet package whose exact x402 price
 * is the orchestration fee plus its bounded creator-spend cap. A durable authorization-keyed order
 * ensures one settled inbound authorization can launch downstream creator payments only once.
 */

import { NextRequest } from "next/server";
import { collectRun } from "@/lib/agent";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { makePayment } from "@/lib/payments/payment-gateway";
import { settleThenServe, challengeResponse } from "@/lib/x402-server";
import { a2aDiscovery } from "@/lib/x402-discovery";
import { verifyApiKey } from "@/lib/api-keys";
import { hasScope, parseScopes } from "@/lib/api-key-scopes";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { parseAskQuestion } from "@/lib/ask-input";
import {
  a2aReceiptEconomics,
  parseResearchMode,
  quoteA2aResearch,
  type A2aQuote,
} from "@/lib/a2a/pricing";
import { a2aOrderId, a2aRequestHash, sameA2aOrder, type A2aOrder } from "@/lib/a2a/order";
import type { QueryRun } from "@/lib/types";
import type { KeryxDB } from "@/lib/db/keryx-db";
import { paymentSettlementStatus } from "@/lib/payments/payment-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function requirements(priceUsdc: number, payTo = config.sellerAddress ?? "") {
  return {
    priceUsdc,
    payTo,
    endpoint: "/api/agent/ask",
    description: "Keryx autonomous research — fixed fee + creator-spend cap",
    discovery: a2aDiscovery as unknown as Record<string, unknown>,
  };
}

function responseFromRun(run: QueryRun, quote: ReturnType<typeof quoteA2aResearch>) {
  if (run.paymentMode !== "real") {
    throw new Error("paid A2A research did not use the real treasury gateway");
  }
  return {
    status: "completed",
    queryId: run.id,
    answer: run.answer,
    citations: run.citations.map((citation) => ({
      source: citation.sourceName,
      weight: citation.weight,
      reward: citation.reward,
    })),
    evidence: (run.evidence ?? []).filter((item) => item.qualifiesForReward),
    claimCoverage: run.claimCoverage ?? [],
    creatorsPaid: run.citations.length,
    totalToCreators: run.totalToCreators,
    feePaid: quote.serviceFeeUsdc,
    totalPricePaid: quote.totalPriceUsdc,
    pricing: a2aReceiptEconomics(quote, run.totalToCreators, run.pendingSpendUsdc ?? 0),
    engine: run.engine,
  } satisfies Record<string, unknown>;
}

function quoteFromOrder(order: A2aOrder): A2aQuote {
  return {
    policy: "a2a-fixed-package-v2",
    researchMode: order.researchMode,
    creatorBudgetUsdc: order.creatorBudgetUsdc,
    serviceFeeUsdc: order.serviceFeeUsdc,
    totalPriceUsdc: order.amountUsdc,
    refundable: false,
  };
}

async function currentCompletedResponse(db: KeryxDB, order: A2aOrder) {
  const attempts = await db.listCreatorPaymentAttemptsByQuery(order.queryId);
  const settled = attempts
    .filter((payment) => paymentSettlementStatus(payment) === "settled")
    .reduce((sum, payment) => sum + payment.amountUsdc, 0);
  const pending = attempts
    .filter((payment) => paymentSettlementStatus(payment) === "pending")
    .reduce((sum, payment) => sum + payment.amountUsdc, 0);
  return {
    ...(order.response ?? {}),
    totalToCreators: Math.round(settled * 1e6) / 1e6,
    pricing: a2aReceiptEconomics(quoteFromOrder(order), settled, pending),
  };
}

/** Side-effect-free discovery probe. POST recomputes the exact price from its JSON body. */
export async function GET(req?: NextRequest) {
  const queryId = req?.nextUrl.searchParams.get("queryId");
  if (queryId) {
    if (!/^a2a_[a-f0-9]{64}$/.test(queryId)) {
      return Response.json({ error: "invalid A2A query id" }, { status: 400 });
    }
    const db = await getDb();
    const order = await db.getA2aOrder(queryId);
    if (!order) return Response.json({ error: "A2A order not found" }, { status: 404 });
    if (order.status === "completed" && order.response) {
      return Response.json(await currentCompletedResponse(db, order));
    }
    if (order.status === "failed") {
      return Response.json({ status: "failed", queryId, error: order.errorCode ?? "research_failed" });
    }
    const saved = await db.getQueryRun(queryId);
    if (saved) {
      const recovered = responseFromRun(saved, quoteFromOrder(order));
      await db.completeA2aOrder(queryId, recovered, new Date().toISOString());
      return Response.json(recovered);
    }
    return Response.json({ status: "processing", queryId });
  }
  if (!config.sellerAddress || !config.funderKey || process.env.KERYX_FORCE_OFFLINE === "1") {
    return Response.json({ error: "real A2A treasury is unavailable" }, { status: 503 });
  }
  const quote = quoteA2aResearch(undefined, "deep");
  return challengeResponse(requirements(quote.totalPriceUsdc), {
    service: "Keryx — agent-to-agent research endpoint",
    method: "POST",
    pricingPolicy: quote.policy,
    defaultQuote: quote,
    network: config.networkId,
    payTo: config.sellerAddress,
    request: {
      question: "string (required)",
      budget: `creator-spend cap in USDC (optional, max ${config.a2aMaxBudget})`,
      researchMode: "quick | deep (optional; default deep)",
    },
    response: "cited answer + itemized service fee, creator spend, and unused reserve",
    docs: "/api/docs",
    note: "POST returns an exact body-dependent 402 challenge: orchestration fee + creator-spend cap. The fixed package is non-refundable; actual creator spend and unused reserve are itemized.",
  });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  if (rawKey) {
    const keyCtx = await verifyApiKey(rawKey);
    if (!keyCtx) return Response.json({ error: "invalid or revoked api key" }, { status: 401 });
    const limited = await checkRateLimit(keyCtx.keyId, "ask");
    if (limited) return limited;
    if (!hasScope(parseScopes(keyCtx.scopes), "ask")) {
      return Response.json({ error: "this api key is not scoped for ask" }, { status: 403 });
    }
    const db = await getDb();
    void db.incrementUsage(keyCtx.keyId);
  } else {
    const limited = await checkRateLimit(clientIp(req), "a2aPublic");
    if (limited) return limited;
  }
  if (!config.sellerAddress || !config.funderKey || process.env.KERYX_FORCE_OFFLINE === "1") {
    return Response.json({ error: "real A2A treasury is unavailable" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    question?: unknown;
    budget?: unknown;
    model?: unknown;
    researchMode?: unknown;
  };
  const parsedQuestion = parseAskQuestion(body.question);
  if (!parsedQuestion.success) {
    return Response.json({ error: parsedQuestion.error }, { status: 400 });
  }
  const researchMode = parseResearchMode(body.researchMode);
  const quote = quoteA2aResearch(body.budget, researchMode);
  const treasury = config.sellerAddress;
  if (!treasury) return Response.json({ error: "treasury wallet not configured" }, { status: 500 });
  const model =
    typeof body.model === "string" ? body.model.trim().slice(0, 64) || undefined : undefined;
  const requestHash = a2aRequestHash({
    question: parsedQuestion.question,
    creatorBudgetUsdc: quote.creatorBudgetUsdc,
    serviceFeeUsdc: quote.serviceFeeUsdc,
    researchMode,
    model,
  });

  const isBot = !!config.botKey && req.nextUrl.searchParams.get("bot") === config.botKey;
  return settleThenServe(req, requirements(quote.totalPriceUsdc, treasury), async (settle) => {
    const db = await getDb();
    const authorizationId = settle.authorizationId ?? `transaction:${settle.transaction}`;
    if (!settle.transaction) {
      throw new Error("settled A2A payment omitted its transaction evidence");
    }
    if (Math.round(settle.amountUsdc * 1e6) !== Math.round(quote.totalPriceUsdc * 1e6)) {
      throw new Error("settled A2A amount disagrees with the signed package quote");
    }
    const orderId = a2aOrderId({
      network: config.networkId,
      payer: settle.payer,
      payee: treasury,
      authorizationId,
    });
    const queryId = orderId;
    const origin = isBot ? "engine" : "a2a";
    const now = new Date().toISOString();
    const proposedOrder: A2aOrder = {
      id: orderId,
      queryId,
      authorizationId,
      requestHash,
      payer: settle.payer,
      payee: treasury,
      amountUsdc: quote.totalPriceUsdc,
      creatorBudgetUsdc: quote.creatorBudgetUsdc,
      serviceFeeUsdc: quote.serviceFeeUsdc,
      researchMode,
      status: "running",
      transaction: settle.transaction,
      response: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.recordPaymentOnce(
      makePayment({
        id: `inbound_${orderId}`,
        kind: "inbound",
        queryId,
        sourceId: "a2a",
        sourceName: "A2A caller",
        payer: settle.payer,
        payee: treasury,
        amountUsdc: quote.totalPriceUsdc,
        txHash: settle.transaction,
        authorizationId,
        settled: true,
        origin,
        rationale: `A2A v2 package: $${quote.serviceFeeUsdc} service fee + $${quote.creatorBudgetUsdc} creator-spend cap.`,
      }),
    );

    const claimed = await db.createA2aOrder(proposedOrder);
    if (!sameA2aOrder(claimed.order, proposedOrder)) {
      throw new Error("A2A authorization replay disagrees with its original economic tuple");
    }
    if (!claimed.created) {
      if (claimed.order.status === "completed" && claimed.order.response) {
        return { ...(await currentCompletedResponse(db, claimed.order)), replayed: true };
      }
      if (claimed.order.status === "failed") {
        return {
          status: "failed",
          queryId,
          error: claimed.order.errorCode ?? "research_failed",
          replayed: true,
        };
      }
      // Recover the narrow crash window after collectRun saved but before order completion landed.
      const saved = await db.getQueryRun(queryId);
      if (saved) {
        const recovered = responseFromRun(saved, quote);
        await db.completeA2aOrder(orderId, recovered, new Date().toISOString());
        return { ...recovered, replayed: true };
      }
      return { status: "processing", queryId, replayed: true };
    }

    try {
      const run = await collectRun({
        question: parsedQuestion.question,
        budget: quote.creatorBudgetUsdc,
        researchMode,
        queryId,
        origin,
        fundingOwner: "treasury",
        model,
      });
      const response = responseFromRun(run, quote);
      if (!(await db.completeA2aOrder(orderId, response, new Date().toISOString()))) {
        throw new Error("A2A order completion lost its running-state claim");
      }
      return response;
    } catch (error) {
      await db.failA2aOrder(orderId, "research_failed", new Date().toISOString()).catch(() => false);
      throw error;
    }
  });
}
