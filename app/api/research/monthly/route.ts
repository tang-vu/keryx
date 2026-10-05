import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { addressSchema, authorizationSchema } from "@/lib/buyer/protocol";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { monthlyAdmissionQuote, monthlyConfigured, assertMonthlyExecutionReady } from "@/lib/monthly/readiness";
import { monthlyIdSchema, MONTHLY_PATH, monthlyQuoteSchema, monthlyRedeemSchema } from "@/lib/monthly/protocol";
import { monthlyPaymentAuthorization, monthlyQuestionDigest, redeemMonthly, verifyMonthlyProof } from "@/lib/monthly/service";
import { monthlyPurchaseId } from "@/lib/db/research-monthly";
import { a2aResearchPackageForVersion } from "@/lib/a2a/research-package";
import { settleThenServe } from "@/lib/x402-server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { makePayment } from "@/lib/payments/payment-gateway";
import { paidResearchAdmissionResponse } from "@/lib/research/paid-admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit(clientIp(req), "a2aPublic"); if (limited) return limited;
  try {
    if (req.nextUrl.searchParams.get("quote") === "1") {
      try { return response({ quote: await monthlyAdmissionQuote(await getDb()) }); }
      catch { return response({ error: "Monthly unavailable" }, 503); }
    }
    const monthlyId = monthlyIdSchema.parse(req.nextUrl.searchParams.get("id"));
    const proof = JSON.parse(req.headers.get("x-keryx-monthly-proof") ?? "null");
    const payer = await verifyMonthlyProof("status", { monthlyId }, proof);
    const record = await (await getDb()).getResearchMonthly(monthlyId);
    if (!record || record.purchase.payer.toLowerCase() !== payer.toLowerCase()) return response({ error: "Monthly plan not found" }, 404);
    return response({ ...record, remaining: 4 - record.redemptions.length, expired: Date.now() >= Date.parse(record.purchase.expiresAt) });
  } catch { return response({ error: "Invalid Monthly lookup or wallet proof" }, 400); }
}

export async function POST(req: NextRequest) {
  const paused = paidResearchAdmissionResponse(); if (paused) return paused;
  const limited = await checkRateLimit(clientIp(req), "a2aPublic"); if (limited) return limited;
  if (!monthlyConfigured()) return response({ error: "Monthly unavailable" }, 503);
  try {
    const accepted = monthlyQuoteSchema.parse(await req.json());
    const db = await getDb();
    let quote;
    try { quote = await monthlyAdmissionQuote(db); }
    catch { return response({ error: "Monthly custody or payment authority unavailable" }, 503); }
    if (accepted.quoteId !== quote.quoteId || JSON.stringify(accepted) !== JSON.stringify(quote)) return response({ error: "Price changed; review again" }, 409);
    const signed = req.headers.get("payment-signature");
    const authorization = signed ? await monthlyPaymentAuthorization(signed, quote.payee, quote.totalMicros) : null;
    const issued = authorization ?? authorizationSchema.parse({ from: addressSchema.parse(req.headers.get("x-keryx-monthly-payer")),
      to: quote.payee, value: String(quote.totalMicros), nonce: `0x${randomBytes(32).toString("hex")}`,
      validAfter: String(Math.floor(Date.now() / 1000) - 600), validBefore: String(Math.floor(Date.now() / 1000) + config.maxTimeoutSeconds) });
    const expiresAt = signed ? req.headers.get("x-keryx-monthly-expires") ?? "" : String(Math.floor(Date.now() / 1000) + 600);
    await db.claimResearchPurchase({ network: config.networkId, payer: issued.from, payee: issued.to,
      authorizationId: issued.nonce, purpose: "monthly", requestHash: quote.quoteId, amountMicros: quote.totalMicros,
      issued: { validAfter: issued.validAfter, validBefore: issued.validBefore, expiresAt }, requireExisting: !!signed });
    const result = await settleThenServe(req, { priceUsdc: quote.totalMicros / 1e6, payTo: quote.payee, endpoint: MONTHLY_PATH,
      purchasePurpose: "monthly", purchaseRequestHash: quote.quoteId,
      description: "Research Monthly: four Deep requests, 30 days, manual renewal" }, async settle => {
      if (!authorization || settle.network !== config.profile.networkId || !settle.transaction || settle.payer.toLowerCase() !== authorization.from.toLowerCase()
        || settle.authorizationId !== authorization.nonce || Math.round(settle.amountUsdc * 1e6) !== quote.totalMicros) throw new Error("Monthly settlement mismatch");
      const db = await getDb();
      const id = monthlyPurchaseId({ network: config.networkId, payer: settle.payer, payee: quote.payee, authorizationId: authorization.nonce });
      const existing = await db.getResearchMonthly(id);
      const createdAt = existing?.purchase.createdAt ?? new Date().toISOString();
      const result = await db.createResearchMonthly({ id, payer: settle.payer, payee: quote.payee, authorizationId: authorization.nonce,
        ...(!config.profile.testnet ? { format: "keryx-research-monthly-purchase-v2" as const,
          network: config.profile.networkId, asset: config.profile.usdcAddress.toLowerCase(), gatewayContract: config.profile.gatewayWallet.toLowerCase() } : {}),
        quoteId: quote.quoteId,
        transaction: settle.transaction, createdAt, expiresAt: new Date(Date.parse(createdAt) + 30 * 86400_000).toISOString(),
        creatorBudgetMicros: quote.creatorBudgetMicros, serviceFeeMicros: quote.serviceFeeMicros, totalMicros: quote.totalMicros,
        researchPackage: a2aResearchPackageForVersion("deep", quote.packageVersion)! });
      await db.recordPaymentOnce(makePayment({ id: `inbound_${id}`, kind: "inbound", queryId: id,
        sourceId: "research-monthly", sourceName: "Research Monthly buyer", payer: settle.payer, payee: quote.payee,
        amountUsdc: quote.totalMicros / 1e6, txHash: result.purchase.transaction, authorizationId: authorization.nonce,
        settled: true, origin: "a2a", rationale: "Research Monthly: four prepaid requests; creator reserves unchanged; no automatic renewal." }));
      return response({ monthlyId: id, purchase: result.purchase, replayed: !result.created });
    });
    if (!signed && result.status === 402) {
      result.headers.set("x-keryx-monthly-authorization", JSON.stringify(issued));
      result.headers.set("x-keryx-monthly-expires", expiresAt);
    }
    return result;
  } catch { return response({ error: "Monthly purchase refused. Keep any original recovery file and check its status before purchasing again." }, 400); }
}

export async function PATCH(req: NextRequest) {
  const limited = await checkRateLimit(clientIp(req), "a2aPublic"); if (limited) return limited;
  try {
    const input = monthlyRedeemSchema.parse(await req.json());
    const payer = await verifyMonthlyProof("redeem", { monthlyId: input.monthlyId, requestId: input.requestId, questionDigest: monthlyQuestionDigest(input.question) }, input.proof);
    const db = await getDb(); const record = await db.getResearchMonthly(input.monthlyId);
    if (!record || record.purchase.payer.toLowerCase() !== payer.toLowerCase()) return response({ error: "Monthly plan not found" }, 404);
    if (!record.redemptions.some(value => value.requestId === input.requestId)) {
      if (!monthlyConfigured()) return response({ error: "Monthly admission unavailable; original jobs remain recoverable" }, 503);
      try { await assertMonthlyExecutionReady(db, record.purchase.creatorBudgetMicros); }
      catch { return response({ error: "Monthly current execution capacity unavailable; no slot consumed" }, 503); }
    }
    const result = await redeemMonthly(db, record.purchase, { ...input, payer });
    return response({ queryId: result.order.id, status: result.order.status, replayed: !result.created,
      location: `/api/agent/ask?queryId=${result.order.id}` }, result.created ? 202 : 200);
  } catch { return response({ error: "Request refused: check wallet proof, term, available slots and original request identity" }, 409); }
}
