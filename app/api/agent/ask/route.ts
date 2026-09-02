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
  parseResearchMode,
  quoteA2aResearch,
} from "@/lib/a2a/pricing";
import {
  A2A_REVIEW_AFTER_MS,
  a2aOrderId,
  a2aRequestHash,
  sameA2aOrder,
  type A2aOrder,
} from "@/lib/a2a/order";
import {
  currentA2aEconomics,
  publicA2aResolution,
  quoteFromA2aOrder,
} from "@/lib/a2a/result";
import {
  repairA2aOrderFromSavedRun,
  verifiedA2aResponseFromRun,
} from "@/lib/a2a/operator-resolution";
import type { KeryxDB } from "@/lib/db/keryx-db";
import {
  A2A_RESEARCH_PACKAGE_VERSION,
  acceptsA2aPackageVersion,
  failedA2aServiceReceipt,
  isSupportedA2aResearchPackage,
  listA2aResearchPackages,
  pendingA2aServiceStatus,
  supportedA2aPackageVersions,
} from "@/lib/a2a/research-package";

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

async function currentCompletedResponse(db: KeryxDB, order: A2aOrder) {
  const attempts = await db.listCreatorPaymentAttemptsByQuery(order.queryId);
  const economics = currentA2aEconomics(order, attempts);
  return {
    ...(order.response ?? {}),
    totalToCreators: economics.totalToCreators,
    pricing: economics.pricing,
  };
}

async function currentFailedResponse(db: KeryxDB, order: A2aOrder, replayed = false) {
  const attempts = await db.listCreatorPaymentAttemptsByQuery(order.queryId);
  const economics = currentA2aEconomics(order, attempts);
  const accountingComplete =
    order.executionJournalVersion === 1 &&
    order.paymentStartedAt === null &&
    economics.creatorPayments.attempts === 0;
  const researchPackage = isSupportedA2aResearchPackage(
    order.researchPackage,
    order.researchMode,
  )
    ? order.researchPackage
    : null;
  return {
    status: "failed",
    queryId: order.queryId,
    error: order.errorCode ?? "research_failed",
    pricing: accountingComplete
      ? { ...economics.pricing, accountingComplete: true }
      : {
          ...economics.pricing,
          unusedCreatorReserveUsdc: null,
          accountingComplete: false,
        },
    creatorPayments: { ...economics.creatorPayments, accountingComplete },
    ...(researchPackage
      ? {
          researchPackage,
          serviceReceipt: failedA2aServiceReceipt({
            researchPackage,
            acceptedAt: order.createdAt,
            startedAt: order.startedAt,
            finishedAt: order.updatedAt,
          }),
        }
      : {}),
    ...(!accountingComplete
      ? {
          message:
            "Recorded creator payments are a lower bound; the job crossed a payment boundary without a complete saved run.",
        }
      : {}),
    ...(order.resolution ? { resolution: publicA2aResolution(order) } : {}),
    ...(replayed ? { replayed: true } : {}),
  };
}

function pendingResponse(order: A2aOrder, replayed = false, message?: string) {
  const startedMs = order.startedAt ? Date.parse(order.startedAt) : Number.NaN;
  const needsReview =
    !!order.startedAt &&
    (!Number.isFinite(startedMs) || Date.now() - startedMs >= A2A_REVIEW_AFTER_MS);
  const status = needsReview ? "review_required" : order.startedAt ? "processing" : "queued";
  const researchPackage = isSupportedA2aResearchPackage(
    order.researchPackage,
    order.researchMode,
  )
    ? order.researchPackage
    : null;
  return {
    status,
    queryId: order.queryId,
    pollUrl: `/api/agent/ask?queryId=${encodeURIComponent(order.queryId)}`,
    ...(researchPackage
      ? {
          researchPackage,
          serviceStatus: pendingA2aServiceStatus({
            researchPackage,
            state: status,
            acceptedAt: order.createdAt,
            startedAt: order.startedAt,
          }),
        }
      : {}),
    ...(message
      ? { message }
      : needsReview
        ? { message: "The paid job started but did not finish; operator review is required before any retry." }
        : {}),
    ...(replayed ? { replayed: true } : {}),
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
      return Response.json(await currentFailedResponse(db, order));
    }
    const saved = await db.getQueryRun(queryId);
    if (saved) {
      try {
        const recovered = await repairA2aOrderFromSavedRun(db, order, saved, "automatic-poll");
        return Response.json(await currentCompletedResponse(db, recovered));
      } catch {
        return Response.json(
          pendingResponse(
            order,
            false,
            "A saved result exists, but its creator-payment ledger requires review before delivery.",
          ),
        );
      }
    }
    return Response.json(pendingResponse(order));
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
    researchPackages: listA2aResearchPackages(),
    network: config.networkId,
    payTo: config.sellerAddress,
    request: {
      question: "string (required)",
      budget: `creator-spend cap in USDC (optional, max ${config.a2aMaxBudget})`,
      researchMode: "quick | deep (optional; default deep)",
      packageVersion: `${A2A_RESEARCH_PACKAGE_VERSION} (optional; pins the execution contract)`,
      responseMode: "wait | async (optional; async returns 202 + poll URL)",
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
    packageVersion?: unknown;
    responseMode?: unknown;
  };
  const parsedQuestion = parseAskQuestion(body.question);
  if (!parsedQuestion.success) {
    return Response.json({ error: parsedQuestion.error }, { status: 400 });
  }
  const researchMode = parseResearchMode(body.researchMode);
  if (!acceptsA2aPackageVersion(body.packageVersion)) {
    return Response.json(
      {
        error: "unsupported A2A research package version",
        supportedPackageVersions: supportedA2aPackageVersions(),
      },
      { status: 409 },
    );
  }
  const packageVersion =
    typeof body.packageVersion === "string"
      ? body.packageVersion
      : A2A_RESEARCH_PACKAGE_VERSION;
  const quote = quoteA2aResearch(body.budget, researchMode, packageVersion);
  const researchPackage = quote.researchPackage;
  if (!researchPackage) {
    return Response.json({ error: "research package unavailable" }, { status: 503 });
  }
  const treasury = config.sellerAddress;
  if (!treasury) return Response.json({ error: "treasury wallet not configured" }, { status: 500 });
  const model =
    typeof body.model === "string" ? body.model.trim().slice(0, 64) || undefined : undefined;
  if (body.responseMode !== undefined && body.responseMode !== "wait" && body.responseMode !== "async") {
    return Response.json({ error: "responseMode must be wait or async" }, { status: 400 });
  }
  const preferAsync = req.headers
    .get("prefer")
    ?.split(",")
    .some((value) => value.trim().toLowerCase() === "respond-async");
  const respondAsync = body.responseMode === "async" || (body.responseMode === undefined && preferAsync);
  const requestHash = a2aRequestHash({
    question: parsedQuestion.question,
    creatorBudgetUsdc: quote.creatorBudgetUsdc,
    serviceFeeUsdc: quote.serviceFeeUsdc,
    researchMode,
    researchPackage,
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
      researchPackage,
      status: "running",
      transaction: settle.transaction,
      request: { question: parsedQuestion.question, model, origin },
      startedAt: respondAsync ? null : now,
      workerId: respondAsync ? null : `request:${orderId}`,
      executionJournalVersion: 1,
      paymentStartedAt: null,
      resultSavingAt: null,
      response: null,
      errorCode: null,
      resolution: null,
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
        rationale: `A2A ${researchPackage.id}@${researchPackage.version}: $${quote.serviceFeeUsdc} service fee + $${quote.creatorBudgetUsdc} creator-spend cap.`,
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
        return currentFailedResponse(db, claimed.order, true);
      }
      // Recover the narrow crash window after collectRun saved but before order completion landed.
      const saved = await db.getQueryRun(queryId);
      if (saved) {
        try {
          const recovered = await repairA2aOrderFromSavedRun(
            db,
            claimed.order,
            saved,
            "automatic-poll",
          );
          return { ...(await currentCompletedResponse(db, recovered)), replayed: true };
        } catch {
          return pendingResponse(
            claimed.order,
            true,
            "A saved result exists, but its creator-payment ledger requires review before delivery.",
          );
        }
      }
      return pendingResponse(claimed.order, true);
    }

    if (respondAsync) {
      return Response.json(pendingResponse(claimed.order), {
        status: 202,
        headers: {
          Location: `/api/agent/ask?queryId=${encodeURIComponent(queryId)}`,
          "Retry-After": "2",
          ...(preferAsync ? { "Preference-Applied": "respond-async", Vary: "Prefer" } : {}),
        },
      });
    }

    let run: Awaited<ReturnType<typeof collectRun>>;
    try {
      run = await collectRun({
        question: parsedQuestion.question,
        budget: quote.creatorBudgetUsdc,
        researchMode,
        queryId,
        origin,
        fundingOwner: "treasury",
        model,
        executionLimits: { ...researchPackage.execution },
        onCreatorPaymentBoundary: async () => {
          if (!(await db.markA2aOrderPaymentStarted(orderId, new Date().toISOString()))) {
            throw new Error("A2A creator-payment boundary could not be journaled");
          }
        },
        onQueryRunSaveBoundary: async () => {
          if (!(await db.markA2aOrderResultSaving(orderId, new Date().toISOString()))) {
            throw new Error("A2A QueryRun-save boundary could not be journaled");
          }
        },
      });
    } catch (error) {
      await db.failA2aOrder(orderId, "research_failed", new Date().toISOString()).catch(() => false);
      throw error;
    }
    const currentOrder = await db.getA2aOrder(orderId);
    if (!currentOrder || currentOrder.status !== "running") {
      throw new Error("A2A order changed before its saved run could be verified");
    }
    const response = (await verifiedA2aResponseFromRun(db, currentOrder, run)).response;
    // The QueryRun is already durable. If this final CAS is lost or ambiguous, leave the order
    // running so GET/replay can repair it instead of hiding a possibly paid result as failed.
    if (!(await db.completeA2aOrder(orderId, response, new Date().toISOString()))) {
      throw new Error("A2A order completion is pending durable recovery");
    }
    return response;
  });
}
