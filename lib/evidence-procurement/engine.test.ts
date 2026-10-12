import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MAX_PROCUREMENT_BYTES, parseEvidenceProcurement, type EvidenceProcurementPacket, type ProcurementOffer, type ProcurementDelivery } from "./contracts";
import { buildEvidenceProcurement, procurementBodyHash, procurementDeliveryHash, procurementDeliveryMessage,
  procurementOfferHash, procurementOfferMessage, procurementRequestHash } from "./engine";

// Ephemeral synthetic signers; never funded, logged, persisted or submitted to a network.
const signer = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
const now = Date.parse("2026-10-12T12:00:00Z");
const packet = (): EvidenceProcurementPacket => ({ version: 1, scope: "private-evidence-procurement", request: {
  id: "synthetic-request", network: "eip155:5042002", decision: "Synthetic API comparison, not a real provider claim",
  budgetMicroUsdc: "100000", expiresAt: "2026-10-13T12:00:00Z", requirements: [
    { id: "rate", question: "Observed request limit", priority: 8, status: "missing" },
    { id: "region", question: "Required service region", priority: 4, status: "missing" },
    { id: "known", question: "Already supplied information", priority: 10, status: "covered" },
  ] }, offers: [], selectedOfferIds: [], deliveries: [], reviews: [] });
async function offer(input: EvidenceProcurementPacket, changes: Partial<ProcurementOffer> = {}, account = signer): Promise<ProcurementOffer> {
  const row: ProcurementOffer = { id: "one", requestHash: procurementRequestHash(input.request), providerWallet: account.address,
    sourceUrl: "https://provider.example/report", deliverable: "Supply a report and retained exact excerpts", priceMicroUsdc: "50000",
    requirementIds: ["rate"], expiresAt: "2026-10-13T11:00:00Z", nonce: "nonce-one", ...changes };
  row.signature = await account.signMessage({ message: procurementOfferMessage(input.request, row) });
  return row;
}
async function delivery(input: EvidenceProcurementPacket, offered: ProcurementOffer): Promise<ProcurementDelivery> {
  const body = "The synthetic service does not support the required region.";
  const row: ProcurementDelivery = { offerId: offered.id, offerHash: procurementOfferHash(offered), body,
    bodyHash: procurementBodyHash(body), excerpts: [{ requirementId: "region", start: 0, end: body.length, stance: "refutes" }] };
  row.signature = await signer.signMessage({ message: procurementDeliveryMessage(input.request, offered, row) });
  return row;
}

describe("private demand-driven evidence procurement", () => {
  it("recommends the best proposed missing-priority per integer price, with reproducible ties", async () => {
    const input = packet();
    input.offers = [await offer(input), await offer(input, { id: "two", nonce: "two", priceMicroUsdc: "40000", requirementIds: ["rate", "region"] })];
    const result = await buildEvidenceProcurement(input, now);
    expect(result.recommendation?.offerId).toBe("two");
    expect(result.quoteBudget).toEqual({ maximumMicroUsdc: "100000", plannedMicroUsdc: "0", remainingMicroUsdc: "100000", authority: "proposal-only" });
    expect(result.payment.status).toBe("not-observed");
    input.offers[0] = await offer(input, { id: "a", nonce: "a", priceMicroUsdc: "40000", requirementIds: ["rate", "region"] });
    expect((await buildEvidenceProcurement(input, now)).recommendation?.offerId).toBe("a");
    expect((await buildEvidenceProcurement({ ...input, offers: input.offers.toReversed() }, now)).recommendation?.offerId).toBe("a");
  });
  it("counts selected quotes cumulatively without claiming funds held or inventing refunds", async () => {
    const input = packet();
    input.offers = [await offer(input, { priceMicroUsdc: "80000" }), await offer(input, { id: "two", nonce: "two", requirementIds: ["region"], priceMicroUsdc: "30000" })];
    input.selectedOfferIds = ["one"];
    const result = await buildEvidenceProcurement(input, now);
    expect(result.quoteBudget.remainingMicroUsdc).toBe("20000");
    expect(result.offers[1].reason).toBe("outside-quote-budget");
    input.selectedOfferIds.push("two");
    await expect(buildEvidenceProcurement(input, now)).rejects.toThrow("quote budget exceeded");
    input.selectedOfferIds = ["one"];
    expect((await buildEvidenceProcurement(input, Date.parse(input.offers[0].expiresAt))).quoteBudget.plannedMicroUsdc).toBe("80000");
  });
  it("prefers a signed free quote and withholds quotes which add no missing coverage", async () => {
    const input = packet(); input.offers = [await offer(input), await offer(input, { id: "free", nonce: "free", priceMicroUsdc: "0" }),
      await offer(input, { id: "old", nonce: "old", requirementIds: ["known"] })];
    const result = await buildEvidenceProcurement(input, now);
    expect(result.recommendation?.offerId).toBe("free"); expect(result.offers[2].reason).toBe("no-new-proposed-coverage");
  });
  it("does not recommend buying overlapping evidence again after a selected quote expires", async () => {
    const input = packet(); input.offers = [await offer(input, { expiresAt: "2026-10-12T13:00:00Z" }),
      await offer(input, { id: "replacement", nonce: "replacement", priceMicroUsdc: "0" })];
    input.selectedOfferIds = ["one"];
    const result = await buildEvidenceProcurement(input, Date.parse("2026-10-12T14:00:00Z"));
    expect(result.quoteBudget.plannedMicroUsdc).toBe("50000"); expect(result.recommendation).toBeNull();
    expect(result.offers[1].reason).toBe("no-new-proposed-coverage"); expect(result.state).toBe("delivery-or-review-needed");
  });
  it("rejects altered price, terms, provider, source, expiry, nonce and declared requirements", async () => {
    const input = packet(), row = await offer(input);
    const changes = [{ priceMicroUsdc: "1" }, { deliverable: "Changed terms" }, { providerWallet: other.address },
      { sourceUrl: "https://other.example/report" }, { expiresAt: "2026-10-13T10:00:00Z" }, { nonce: "new" }, { requirementIds: ["region"] }];
    for (const change of changes) {
      const result = await buildEvidenceProcurement({ ...input, offers: [{ ...row, ...change }] }, now);
      expect(result.offers[0].reason).toBe("invalid-offer-signature"); expect(result.recommendation).toBeNull();
    }
    const altered = { ...input, request: { ...input.request, network: "eip155:5042" }, offers: [row] };
    expect((await buildEvidenceProcurement(altered, now)).offers[0].reason).toBe("different-request");
  });
  it("withholds every conflicting ID or signer nonce rather than using the first quote", async () => {
    const input = packet(); input.offers = [await offer(input), await offer(input, { id: "one", nonce: "different" })];
    expect((await buildEvidenceProcurement(input, now)).offers.map(row => row.reason)).toEqual(["conflicting-offer", "conflicting-offer"]);
    input.offers[1] = await offer(input, { id: "two" });
    expect((await buildEvidenceProcurement(input, now)).recommendation).toBeNull();
    input.selectedOfferIds = ["one"];
    await expect(buildEvidenceProcurement(input, now)).rejects.toThrow();
  });
  it("does not let unsigned or expired quotes acquire selected payment authority", async () => {
    const input = packet(), row = await offer(input); delete row.signature; input.offers = [row];
    expect((await buildEvidenceProcurement(input, now)).offers[0].reason).toBe("unsigned-offer");
    input.selectedOfferIds = [row.id]; await expect(buildEvidenceProcurement(input, now)).rejects.toThrow();
    input.selectedOfferIds = []; input.offers = [await offer(input)];
    const expired = await buildEvidenceProcurement(input, Date.parse(input.request.expiresAt));
    expect(expired.state).toBe("request-expired"); expect(expired.recommendation).toBeNull();
  });
  it("accepts caller review of separately signed refuting bytes and restores the portable packet", async () => {
    const input = packet(); const row = await offer(input, { requirementIds: ["region"] }); input.offers = [row];
    const delivered = await delivery(input, row); input.deliveries = [delivered];
    input.reviews = [{ offerId: row.id, deliveryHash: procurementDeliveryHash(delivered), acceptedRequirementIds: ["region"],
      reviewer: "Synthetic reviewer", reviewerNote: "This negative finding resolves my region question; not expert validation." }];
    const result = await buildEvidenceProcurement(input, now);
    expect(result.deliveries[0].reason).toBe("attributed-bytes");
    expect(result.deliveries[0].excerpts[0].text).toBe(delivered.body);
    expect(result.reviews[0].reason).toBe("caller-reviewed"); expect(result.missingRequirementIds).toEqual(["rate"]);
    expect(result.reviews[0].authority).toBe("caller-declared");
    expect(await buildEvidenceProcurement(JSON.parse(JSON.stringify(result.packet)), now)).toEqual(result);
  });
  it("withholds wrong bodies, unsigned delivery, cut quote spans and stale reviews", async () => {
    const input = packet(), row = await offer(input, { requirementIds: ["region"] }); input.offers = [row];
    const original = await delivery(input, row);
    input.deliveries = [{ ...original, body: original.body + " altered" }];
    expect((await buildEvidenceProcurement(input, now)).deliveries[0].reason).toBe("body-hash-mismatch");
    input.deliveries = [{ ...original, signature: undefined }];
    expect((await buildEvidenceProcurement(input, now)).deliveries[0].reason).toBe("unsigned-delivery");
    input.deliveries = [{ ...original, excerpts: [{ ...original.excerpts[0], end: original.body.length + 1 }] }];
    expect((await buildEvidenceProcurement(input, now)).deliveries[0].reason).toBe("invalid-excerpt");
    input.deliveries = [original];
    input.reviews = [{ offerId: row.id, deliveryHash: procurementBodyHash("wrong"), acceptedRequirementIds: ["region"], reviewer: "Synthetic", reviewerNote: "Stale" }];
    expect((await buildEvidenceProcurement(input, now)).reviews[0].reason).toBe("unbound-review");
  });
  it("does not promote inconclusive excerpts or duplicate reviews into resolved requirements", async () => {
    const input = packet(), row = await offer(input, { requirementIds: ["region"] }); input.offers = [row];
    const delivered = await delivery(input, row); delivered.excerpts[0].stance = "inconclusive";
    delivered.signature = await signer.signMessage({ message: procurementDeliveryMessage(input.request, row, delivered) }); input.deliveries = [delivered];
    const review = { offerId: row.id, deliveryHash: procurementDeliveryHash(delivered), acceptedRequirementIds: ["region"], reviewer: "Synthetic", reviewerNote: "Not enough" };
    input.reviews = [review]; expect((await buildEvidenceProcurement(input, now)).reviews[0].reason).toBe("unbound-review");
    input.reviews = [review, review]; expect((await buildEvidenceProcurement(input, now)).missingRequirementIds).toEqual(["rate", "region"]);
  });
  it("refuses unknown authority fields, fractions, duplicate requirements, unsafe links and huge inputs", () => {
    expect(() => parseEvidenceProcurement({ ...packet(), settled: true })).toThrow();
    const input = packet(); input.request.budgetMicroUsdc = "0.10"; expect(() => parseEvidenceProcurement(input)).toThrow();
    input.request.budgetMicroUsdc = "100000"; input.request.requirements.push(input.request.requirements[0]);
    expect(() => parseEvidenceProcurement(input)).toThrow();
    const privateGetter = Object.defineProperty({}, "request", { enumerable: true, get: () => { throw new Error("PRIVATE_SECRET"); } });
    expect(() => parseEvidenceProcurement(privateGetter)).toThrow("Invalid private evidence procurement packet");
    expect(() => parseEvidenceProcurement({ ...packet(), extra: "x".repeat(MAX_PROCUREMENT_BYTES) })).toThrow();
  });
  it("binds changed requests and keeps offer and delivery signatures in separate domains", async () => {
    const input = packet(), row = await offer(input, { requirementIds: ["region"] }); input.offers = [row];
    const delivered = await delivery(input, row);
    input.deliveries = [{ ...delivered, signature: row.signature }];
    expect((await buildEvidenceProcurement(input, now)).deliveries[0].reason).toBe("invalid-delivery-signature");
    input.deliveries = []; input.offers = [{ ...row, signature: delivered.signature }];
    expect((await buildEvidenceProcurement(input, now)).offers[0].reason).toBe("invalid-offer-signature");
    input.request.network = "eip155:5042";
    input.offers = [{ ...row, requestHash: procurementRequestHash(input.request) }];
    expect((await buildEvidenceProcurement(input, now)).offers[0].reason).toBe("invalid-offer-signature");
  });
  it("rejects duplicated deliveries, changed stances/spans and a wrong delivery signer", async () => {
    const input = packet(), row = await offer(input, { requirementIds: ["region"] }); input.offers = [row];
    const delivered = await delivery(input, row); input.deliveries = [delivered, delivered];
    expect((await buildEvidenceProcurement(input, now)).deliveries.every(result => result.reason === "conflicting-or-unknown-delivery")).toBe(true);
    input.deliveries = [{ ...delivered, offerHash: procurementBodyHash("foreign") }];
    expect((await buildEvidenceProcurement(input, now)).deliveries[0].reason).toBe("different-offer");
    for (const changes of [{ stance: "supports" as const }, { start: 1 }]) {
      input.deliveries = [{ ...delivered, excerpts: [{ ...delivered.excerpts[0], ...changes }] }];
      expect((await buildEvidenceProcurement(input, now)).deliveries[0].reason).toBe("invalid-delivery-signature");
    }
    input.deliveries = [{ ...delivered, signature: await other.signMessage({ message: procurementDeliveryMessage(input.request, row, delivered) }) }];
    expect((await buildEvidenceProcurement(input, now)).deliveries[0].reason).toBe("invalid-delivery-signature");
  });
  it("preserves non-BMP quote bytes and refuses surrogate cuts and malformed UTF-16", async () => {
    const input = packet(), row = await offer(input, { requirementIds: ["region"] }); input.offers = [row];
    const body = "A😀B";
    const delivered: ProcurementDelivery = { offerId: row.id, offerHash: procurementOfferHash(row), body,
      bodyHash: procurementBodyHash(body), excerpts: [{ requirementId: "region", start: 1, end: 3, stance: "supports" }] };
    delivered.signature = await signer.signMessage({ message: procurementDeliveryMessage(input.request, row, delivered) });
    input.deliveries = [delivered]; expect((await buildEvidenceProcurement(input, now)).deliveries[0].excerpts[0].text).toBe("😀");
    for (const span of [{ start: 2, end: 3 }, { start: 1, end: 2 }]) {
      input.deliveries = [{ ...delivered, excerpts: [{ ...delivered.excerpts[0], ...span }] }];
      expect((await buildEvidenceProcurement(input, now)).deliveries[0].reason).toBe("invalid-excerpt");
    }
    expect(() => parseEvidenceProcurement({ ...packet(), request: { ...packet().request, decision: "\ud800" } })).toThrow();
  });
  it("refuses invalid observation times and offers beyond their request window", async () => {
    for (const time of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER])
      await expect(buildEvidenceProcurement(packet(), time)).rejects.toThrow("observation time");
    const input = packet(); input.offers = [await offer(input, { expiresAt: "2026-10-14T12:00:00Z" })];
    expect((await buildEvidenceProcurement(input, now)).offers[0].reason).toBe("outside-request-window");
  });
});
