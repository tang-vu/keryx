import { sha256, stringToHex, verifyMessage } from "viem";
import { canonicalJson } from "../canonical-json";
import { parseEvidenceProcurement, type ProcurementRequest, type ProcurementOffer, type ProcurementDelivery } from "./contracts";

export { MAX_PROCUREMENT_BYTES, parseEvidenceProcurement } from "./contracts";
export const PROCUREMENT_NOTICE = "Private procurement proposal. Signatures authenticate supplied offers and deliveries, not source ownership, factual truth, customer acceptance or payment. Coverage and reviews are declarations. No provider is contacted, benchmark executed, purchase made or creator rewarded.";

export const procurementHash = (value: unknown) => sha256(stringToHex(canonicalJson(value)));
export const procurementBodyHash = (body: string) => sha256(stringToHex(body));
export const procurementRequestHash = (request: ProcurementRequest) => procurementHash(request);
const unsigned = <T extends { signature?: string }>(value: T) => {
  const { signature: _signature, ...data } = value;
  return data;
};
export const procurementOfferHash = (offer: ProcurementOffer) => procurementHash(unsigned(offer));
export const procurementDeliveryHash = (delivery: ProcurementDelivery) => procurementHash(unsigned(delivery));
export const procurementOfferMessage = (request: ProcurementRequest, offer: ProcurementOffer) =>
  `Keryx evidence procurement offer\nVersion: 1\nNetwork: ${request.network}\nRequest: ${procurementRequestHash(request)}\nOffer: ${procurementOfferHash(offer)}\nThis signs a quotation only. It authorizes no payment or source ownership.`;
export const procurementDeliveryMessage = (request: ProcurementRequest, offer: ProcurementOffer, delivery: ProcurementDelivery) =>
  `Keryx evidence procurement delivery\nVersion: 1\nNetwork: ${request.network}\nRequest: ${procurementRequestHash(request)}\nOffer: ${procurementOfferHash(offer)}\nDelivery: ${procurementDeliveryHash(delivery)}\nThis attests supplied bytes only. It authorizes no payment or factual verdict.`;

async function signed(wallet: string, message: string, signature?: string) {
  if (!signature) return false;
  try { return await verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` }); }
  catch { return false; }
}
const repeats = (values: string[]) => new Set(values.filter((value, index) => values.indexOf(value) !== index));
const samePrice = (left: string, right: string) => BigInt(left) === BigInt(right);

/** CPU-only evaluation of private supplied data. A recommendation is not admission
 * to any signer or reservation ledger. Import recomputes every derived result. */
export async function buildEvidenceProcurement(value: unknown, now = Date.now()) {
  const packet = parseEvidenceProcurement(value);
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) throw new Error("Invalid procurement observation time");
  const { request, offers, deliveries, reviews } = packet;
  const requestHash = procurementRequestHash(request), known = new Set(request.requirements.map(row => row.id));
  const duplicateOffers = repeats(offers.map(row => row.id));
  const duplicateNonces = repeats(offers.map(row => `${row.providerWallet.toLowerCase()}:${row.nonce}`));
  const duplicateDeliveries = repeats(deliveries.map(row => row.offerId)), duplicateReviews = repeats(reviews.map(row => row.offerId));
  const offerRows = await Promise.all(offers.map(async offer => {
    let reason = "eligible";
    if (duplicateOffers.has(offer.id) || duplicateNonces.has(`${offer.providerWallet.toLowerCase()}:${offer.nonce}`)) reason = "conflicting-offer";
    else if (offer.requestHash !== requestHash) reason = "different-request";
    else if (offer.requirementIds.some(id => !known.has(id))) reason = "unknown-requirement";
    else if (Date.parse(offer.expiresAt) > Date.parse(request.expiresAt)) reason = "outside-request-window";
    else if (!offer.signature) reason = "unsigned-offer";
    else if (!await signed(offer.providerWallet, procurementOfferMessage(request, offer), offer.signature)) reason = "invalid-offer-signature";
    else if (Date.parse(offer.expiresAt) <= now) reason = "expired-offer";
    return { id: offer.id, offerHash: procurementOfferHash(offer), reason, priceMicroUsdc: offer.priceMicroUsdc,
      providerWallet: offer.providerWallet, sourceUrl: offer.sourceUrl, proposedRequirementIds: offer.requirementIds,
      selected: packet.selectedOfferIds.includes(offer.id), newRequirementIds: [] as string[], priority: 0 };
  }));

  // Retain declared selections as proposed commitments even after quote expiry.
  // Nothing here calls them a financial reservation or releases an original debit.
  if (packet.selectedOfferIds.some(id => !offers.some(offer => offer.id === id) || duplicateOffers.has(id)))
    throw new Error("Invalid private evidence procurement selection");
  const selectedRows = offerRows.filter(row => row.selected);
  if (selectedRows.some(row => !["eligible", "expired-offer"].includes(row.reason))) throw new Error("Invalid private evidence procurement selection");
  const planned = selectedRows.reduce((sum, row) => sum + BigInt(row.priceMicroUsdc), BigInt(0));
  if (planned > BigInt(request.budgetMicroUsdc)) throw new Error("Private evidence procurement quote budget exceeded");
  const budgetRemaining = BigInt(request.budgetMicroUsdc) - planned;

  const deliveryRows = await Promise.all(deliveries.map(async delivery => {
    const offer = offers.find(row => row.id === delivery.offerId), row = offerRows.find(row => row.id === delivery.offerId);
    let reason = "attributed-bytes";
    if (!offer || !row || duplicateOffers.has(delivery.offerId) || duplicateDeliveries.has(delivery.offerId)) reason = "conflicting-or-unknown-delivery";
    else if (!["eligible", "expired-offer"].includes(row.reason)) reason = "unattributed-offer";
    else if (delivery.offerHash !== procurementOfferHash(offer)) reason = "different-offer";
    else if (delivery.bodyHash !== procurementBodyHash(delivery.body)) reason = "body-hash-mismatch";
    else if (delivery.excerpts.some(excerpt => excerpt.start >= excerpt.end || excerpt.end > delivery.body.length ||
      !offer.requirementIds.includes(excerpt.requirementId) || !delivery.body.slice(excerpt.start, excerpt.end).trim() ||
      // UTF-16 slices must not split a surrogate pair.
      (excerpt.start > 0 && /[\uDC00-\uDFFF]/u.test(delivery.body[excerpt.start])) ||
      (excerpt.end < delivery.body.length && /[\uDC00-\uDFFF]/u.test(delivery.body[excerpt.end])))) reason = "invalid-excerpt";
    else if (!delivery.signature) reason = "unsigned-delivery";
    else if (!await signed(offer.providerWallet, procurementDeliveryMessage(request, offer, delivery), delivery.signature)) reason = "invalid-delivery-signature";
    return { offerId: delivery.offerId, deliveryHash: procurementDeliveryHash(delivery), reason,
      excerpts: reason === "attributed-bytes" ? delivery.excerpts.map(excerpt => ({ ...excerpt,
        text: delivery.body.slice(excerpt.start, excerpt.end), stanceAuthority: "provider-declared" as const })) : [] };
  }));
  const reviewRows = reviews.map(review => {
    const delivery = deliveryRows.find(row => row.offerId === review.offerId);
    const admissible = !duplicateReviews.has(review.offerId) && delivery?.reason === "attributed-bytes" &&
      review.deliveryHash === delivery.deliveryHash && review.acceptedRequirementIds.every(id =>
        delivery.excerpts.some(excerpt => excerpt.requirementId === id && excerpt.stance !== "inconclusive"));
    return { ...review, reason: admissible ? "caller-reviewed" : "unbound-review", authority: "caller-declared" as const,
      acceptedRequirementIds: admissible ? review.acceptedRequirementIds : [] };
  });
  const reviewed = new Set(reviewRows.flatMap(row => row.acceptedRequirementIds));
  const missing = request.requirements.filter(row => row.status === "missing" && !reviewed.has(row.id));
  const promised = new Set(selectedRows.flatMap(row => row.proposedRequirementIds));
  const uncovered = missing.filter(row => !promised.has(row.id));
  for (const row of offerRows) {
    row.newRequirementIds = uncovered.filter(requirement => row.proposedRequirementIds.includes(requirement.id)).map(requirement => requirement.id);
    row.priority = uncovered.filter(requirement => row.newRequirementIds.includes(requirement.id)).reduce((sum, requirement) => sum + requirement.priority, 0);
    if (row.reason === "eligible" && !row.selected) {
      if (BigInt(row.priceMicroUsdc) > budgetRemaining) row.reason = "outside-quote-budget";
      else if (!row.newRequirementIds.length) row.reason = "no-new-proposed-coverage";
    }
  }
  const ranked = offerRows.filter(row => row.reason === "eligible" && !row.selected).sort((left, right) => {
    // Maximize declared missing-priority per micro-USDC without floating rounding.
    const a = BigInt(left.priceMicroUsdc), b = BigInt(right.priceMicroUsdc);
    if (a === BigInt(0) || b === BigInt(0)) {
      if (a !== b) return a === BigInt(0) ? -1 : 1;
      if (left.priority !== right.priority) return right.priority - left.priority;
    }
    const difference = BigInt(left.priority) * b - BigInt(right.priority) * a;
    if (difference !== BigInt(0)) return difference > BigInt(0) ? -1 : 1;
    if (!samePrice(left.priceMicroUsdc, right.priceMicroUsdc)) return a < b ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const expired = Date.parse(request.expiresAt) <= now;
  const recommendation = !expired && ranked.length ? { offerId: ranked[0].id, reason: "highest-proposed-priority-per-micro-usdc",
    proposedRequirementIds: ranked[0].newRequirementIds, quotedMicroUsdc: ranked[0].priceMicroUsdc } : null;
  return { version: 1 as const, scope: "private-evidence-procurement-result" as const, packet, requestHash,
    observedAt: new Date(now).toISOString(), notice: PROCUREMENT_NOTICE,
    state: expired ? "request-expired" : !missing.length ? (reviewed.size ? "caller-reviewed" : "no-missing-requirements") : recommendation ? "offer-recommended" :
      selectedRows.length ? "delivery-or-review-needed" : "awaiting-eligible-offers",
    missingRequirementIds: missing.map(row => row.id), offers: offerRows, deliveries: deliveryRows, reviews: reviewRows,
    quoteBudget: { maximumMicroUsdc: request.budgetMicroUsdc, plannedMicroUsdc: String(planned), remainingMicroUsdc: String(budgetRemaining), authority: "proposal-only" as const },
    recommendation, payment: { status: "not-observed" as const, settlementAuthority: "existing-buyer-and-registry-only" as const },
  };
}
export type EvidenceProcurementResult = Awaited<ReturnType<typeof buildEvidenceProcurement>>;
