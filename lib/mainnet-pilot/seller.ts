import { createHash } from "node:crypto";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { config } from "../config";
import { verifyBrowserSignature } from "../payments/verify-browser-signature";
import { assertExpectedRequirements, settlementReference, type PaymentRequirements } from "../payments/x402-payment-evidence";
import { sourceItemIdentity, matchesSourceItemIdentity } from "../sources/source-item-asset";
import { resolveSourceItemContent } from "../sources/resolve-source-item-content";
import { assertPilotServerContext, type PilotServerContext } from "./server-context";

/** Injected only by the explicit synthetic composition. Live SDK construction stays closed. */
export interface PilotFacilitator {
  verify(payload: unknown, requirements: PaymentRequirements): Promise<{ isValid: boolean }>;
  settle(payload: unknown, requirements: PaymentRequirements): Promise<{ success: boolean; payer: string; network: string; transaction: string }>;
}
const denied = (status = 403) => Response.json({ error: "pilot_payment_refused" }, { status });

export async function servePilotPayment(request: Request, context: PilotServerContext, facilitator: PilotFacilitator): Promise<Response> {
  try {
    assertPilotServerContext(context);
    const url = new URL(request.url);
    const match = /^\/api\/mainnet-pilot\/(source|cite)\/(0x[0-9a-f]{64})(?:\/item\/([^/]+))?$/.exec(url.pathname);
    if (url.origin !== context.policy.origin || !match ||
        request.method !== (match[1] === "source" ? "GET" : "POST")) return denied();
    const kind = match[1] === "source" ? "fetch" : "citation";
    const stored = await context.db.getSource(match[2]);
    if (!stored) return denied(404);
    const { source, terms } = await context.sourceAuthority.resolve(stored);
    const item = kind === "fetch" && match[3] ? await context.db.getItem(source.id, decodeURIComponent(match[3])) : null;
    const identity = item ? sourceItemIdentity(item) : undefined;
    if (kind === "fetch" && (!item || !identity || url.searchParams.size !== 1 ||
        url.searchParams.get("version") !== identity.contentVersion || item.storageMode !== "db_encrypted" ||
        item.deliveryKind !== "full_text" || !item.bodyHash || !item.plaintextBytes || item.manifest)) return denied(409);
    let amount = Math.round(terms.listPriceUsdc * 1e6), payee = terms.payTo;
    if (kind === "citation") {
      const decimal = url.searchParams.get("amount"), author = url.searchParams.get("author");
      if (match[3] || url.searchParams.size !== 2 || !decimal || !/^(0|[1-9]\d*)\.\d{6}$/.test(decimal) || !author) return denied();
      amount = Number(decimal.replace(".", "")); payee = author.toLowerCase();
      await context.sourceAuthority.citation(source, payee);
    }
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > context.policy.limits.perPaymentMicros) return denied();
    const requirements: PaymentRequirements = { scheme: "exact", network: profile.networkId, asset: profile.usdcAddress,
      amount: String(amount), payTo: payee, maxTimeoutSeconds: config.maxTimeoutSeconds,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } };
    const header = request.headers.get("payment-signature");
    if (!header) {
      const challenge = { x402Version: 2, resource: { url: request.url, mimeType: "application/json" }, accepts: [requirements] };
      return Response.json({}, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(challenge)).toString("base64") } });
    }
    if (header.length > 4096) return denied(400);
    const inner = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const journal = context.admissions.journalByNonce(inner?.authorization?.nonce);
    if (!journal || journal.phase !== "submission_attempted" || journal.payment.kind !== kind ||
        journal.payment.sourceId !== source.id || journal.payment.offerId ||
        (identity && !matchesSourceItemIdentity(journal.payment, identity))) return denied(409);
    assertExpectedRequirements(journal.requirements, payee, amount / 1e6, profile);
    const grant = await context.getGrant(journal.sessionId);
    if (!grant || grant.grantEpoch !== journal.grantEpoch || grant.sessAddr.toLowerCase() !== journal.signer.toLowerCase()) return denied();
    await verifyBrowserSignature(header, { requirements: journal.requirements, expectedSigner: journal.signer,
      expectedNonce: journal.nonce }, undefined, 0, profile);
    const hash = createHash("sha256").update(header).digest("hex");
    if (!context.admissions.claimSettlement(journal.nonce, hash)) return denied(409);
    const payload = { x402Version: 2, resource: { url: request.url, mimeType: "application/json" }, accepted: requirements, payload: inner };
    // A durable claim precedes both calls. Exceptions never authorize a second settlement attempt.
    if (!(await facilitator.verify(payload, requirements)).isValid) return denied(400);
    const receipt = await facilitator.settle(payload, requirements);
    const encoded = Buffer.from(JSON.stringify(receipt)).toString("base64");
    if (!settlementReference(encoded, journal.signer, profile)) return denied(502);
    const headers = { "PAYMENT-RESPONSE": encoded };
    try {
      const content = item ? await resolveSourceItemContent(item, { payer: receipt.payer, transaction: receipt.transaction }, { allowSummaryFallback: false }) : "";
      return Response.json(kind === "fetch" ? { content, name: source.name, item: identity,
        pricing: { offerId: null, priceUsdc: amount / 1e6, listPriceUsdc: terms.listPriceUsdc } } : { ok: true }, { headers });
    } catch { return Response.json({ error: "pilot_delivery_unavailable" }, { status: 503, headers }); }
  } catch { return denied(503); }
}
