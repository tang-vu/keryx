import { NextRequest } from "next/server";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { quoteResearchMonthly } from "@/lib/monthly/quote";
import { monthlyIdSchema, MONTHLY_PATH, monthlyQuoteSchema, monthlyRedeemSchema } from "@/lib/monthly/protocol";
import { monthlyPaymentAuthorization, monthlyQuestionDigest, redeemMonthly, verifyMonthlyProof } from "@/lib/monthly/service";
import { monthlyPurchaseId } from "@/lib/db/research-monthly";
import { a2aResearchPackageForVersion } from "@/lib/a2a/research-package";
import { settleThenServe } from "@/lib/x402-server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { makePayment } from "@/lib/payments/payment-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function enabled() { return process.env.KERYX_MONTHLY_ENABLED === "1" && config.networkId === "eip155:5042002" && !!config.sellerAddress && !!config.funderKey && process.env.KERYX_FORCE_OFFLINE !== "1"; }

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit(clientIp(req), "a2aPublic"); if (limited) return limited;
  try {
    if (req.nextUrl.searchParams.get("quote") === "1") {
      if (!enabled()) return response({ error: "Monthly pilot unavailable" }, 503);
      await (await getDb()).getResearchMonthly(`monthly_${"0".repeat(64)}`);
      return response({ quote: quoteResearchMonthly() });
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
  const limited = await checkRateLimit(clientIp(req), "a2aPublic"); if (limited) return limited;
  if (!enabled()) return response({ error: "Monthly pilot unavailable" }, 503);
  try {
    const accepted = monthlyQuoteSchema.parse(await req.json());
    const quote = quoteResearchMonthly();
    if (accepted.quoteId !== quote.quoteId || JSON.stringify(accepted) !== JSON.stringify(quote)) return response({ error: "Price changed; review again" }, 409);
    const signed = req.headers.get("payment-signature");
    const authorization = signed ? await monthlyPaymentAuthorization(signed, quote.payee, quote.totalMicros) : null;
    return settleThenServe(req, { priceUsdc: quote.totalMicros / 1e6, payTo: quote.payee, endpoint: MONTHLY_PATH,
      purchasePurpose: "monthly", purchaseRequestHash: quote.quoteId,
      description: "Research Monthly: four Deep requests, 30 days, manual renewal" }, async settle => {
      if (!authorization || !settle.transaction || settle.payer.toLowerCase() !== authorization.from.toLowerCase()
        || settle.authorizationId !== authorization.nonce || Math.round(settle.amountUsdc * 1e6) !== quote.totalMicros) throw new Error("Monthly settlement mismatch");
      const db = await getDb();
      const id = monthlyPurchaseId({ network: config.networkId, payer: settle.payer, payee: quote.payee, authorizationId: authorization.nonce });
      const existing = await db.getResearchMonthly(id);
      const createdAt = existing?.purchase.createdAt ?? new Date().toISOString();
      const result = await db.createResearchMonthly({ id, payer: settle.payer, payee: quote.payee, authorizationId: authorization.nonce,
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
  } catch { return response({ error: "Monthly purchase refused. Keep any original recovery file and check its status before purchasing again." }, 400); }
}

export async function PATCH(req: NextRequest) {
  const limited = await checkRateLimit(clientIp(req), "a2aPublic"); if (limited) return limited;
  if (!enabled()) return response({ error: "Monthly admission unavailable; saved jobs remain recoverable" }, 503);
  try {
    const input = monthlyRedeemSchema.parse(await req.json());
    const payer = await verifyMonthlyProof("redeem", { monthlyId: input.monthlyId, requestId: input.requestId, questionDigest: monthlyQuestionDigest(input.question) }, input.proof);
    const db = await getDb(); const record = await db.getResearchMonthly(input.monthlyId);
    if (!record || record.purchase.payer.toLowerCase() !== payer.toLowerCase()) return response({ error: "Monthly plan not found" }, 404);
    const result = await redeemMonthly(db, record.purchase, { ...input, payer });
    return response({ queryId: result.order.id, status: result.order.status, replayed: !result.created,
      location: `/api/agent/ask?queryId=${result.order.id}` }, result.created ? 202 : 200);
  } catch { return response({ error: "Request refused: check wallet proof, term, available slots and original request identity" }, 409); }
}
