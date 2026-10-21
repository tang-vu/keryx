import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseEvidenceProcurement, type EvidenceProcurementPacket, type ProcurementOffer, type ProcurementDelivery } from "./contracts";
import { buildEvidenceProcurement, procurementBodyHash, procurementDeliveryHash, procurementDeliveryMessage,
  procurementOfferHash, procurementOfferMessage, procurementRequestHash } from "./engine";
import { exportEvidenceProcurement, MAX_PROCUREMENT_RECEIPT_BYTES, procurementReceiptFormat } from "./export";

const now = Date.parse("2026-10-12T12:00:00Z"), signer = privateKeyToAccount(generatePrivateKey());
const packet = (): EvidenceProcurementPacket => ({ version: 1, scope: "private-evidence-procurement", request: {
  id: "receipt-request", network: "eip155:5042002", decision: "Synthetic private decision",
  budgetMicroUsdc: "1000000000", expiresAt: "2026-10-13T12:00:00Z", requirements: [
    { id: "region", question: "Required region", priority: 10, status: "missing" },
    { id: "latency", question: "Measured latency", priority: 5, status: "missing" },
    { id: "known", question: "Caller supplied", priority: 1, status: "covered" },
  ] }, offers: [], selectedOfferIds: [], deliveries: [], reviews: [] });
async function fixture() {
  const input = packet();
  const offer: ProcurementOffer = { id: "quote1", requestHash: procurementRequestHash(input.request), providerWallet: signer.address,
    sourceUrl: "https://provider.example/report", deliverable: "Supply signed region evidence", priceMicroUsdc: "999999999",
    requirementIds: ["region"], expiresAt: "2026-10-13T11:00:00Z", nonce: "nonce1" };
  offer.signature = await signer.signMessage({ message: procurementOfferMessage(input.request, offer) });
  const body = "Synthetic finding: region unavailable.";
  const delivery: ProcurementDelivery = { offerId: offer.id, offerHash: procurementOfferHash(offer), body, bodyHash: procurementBodyHash(body),
    excerpts: [{ requirementId: "region", start: 0, end: body.length, stance: "refutes" }] };
  delivery.signature = await signer.signMessage({ message: procurementDeliveryMessage(input.request, offer, delivery) });
  input.offers = [offer]; input.selectedOfferIds = [offer.id]; input.deliveries = [delivery];
  input.reviews = [{ offerId: offer.id, deliveryHash: procurementDeliveryHash(delivery), acceptedRequirementIds: ["region"],
    reviewer: "Caller", reviewerNote: "Negative result resolves the region question." }];
  return input;
}

// Parse quoted multiline records, checking the actual spreadsheet-facing values.
function csvRows(text: string): Record<string, string>[] {
  const records: string[][] = []; let record: string[] = [], cell = "", quoted = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"') {
      if (quoted && text[at + 1] === '"') { cell += '"'; at++; } else quoted = !quoted;
    } else if (!quoted && char === ",") { record.push(cell); cell = ""; }
    else if (!quoted && char === "\r" && text[at + 1] === "\n") {
      record.push(cell); records.push(record); record = []; cell = ""; at++;
    } else cell += char;
  }
  expect(quoted).toBe(false); expect(cell).toBe(""); expect(record).toEqual([]);
  const headers = records.shift()!;
  return records.map(values => { expect(values).toHaveLength(headers.length); return Object.fromEntries(headers.map((key, i) => [key, values[i]])); });
}
afterEach(() => vi.restoreAllMocks());

it("exports a dated complete Markdown inspection with exact amounts and declared review authority", async () => {
  const input = await fixture(), before = structuredClone(input);
  const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No transport"));
  const receipt = await exportEvidenceProcurement(input, "markdown", now);
  expect(receipt.procurement).toEqual(await buildEvidenceProcurement(input, now)); expect(input).toEqual(before);
  expect(receipt.text).toContain("999.999999 USDC (999999999 micro-USDC)");
  expect(receipt.text).toContain("0.000001 USDC (1 micro-USDC)");
  expect(receipt.text).toContain("2026-10-12T12:00:00.000Z");
  for (const value of ["caller-reviewed", "caller-declared-covered", "missing", "not-observed", "proposal", "refutes",
    procurementRequestHash(input.request), procurementOfferHash(input.offers[0]), procurementDeliveryHash(input.deliveries[0])])
    expect(receipt.text).toContain(value);
  expect(receipt.text).toContain("> Synthetic finding\\: region unavailable\\.");
  expect(receipt.text).toContain("Only the original JSON packet can be restored");
  expect(http).not.toHaveBeenCalled();
  expect(() => parseEvidenceProcurement(receipt.procurement)).toThrow();
});
it("uses typed CSV records without multiplying quote amounts across excerpts and reviews", async () => {
  const input = await fixture(), rows = csvRows((await exportEvidenceProcurement(input, "csv", now)).text);
  expect(rows.map(row => row.record_type)).toEqual(["request", "requirement", "requirement", "requirement", "offer", "delivery", "delivery_excerpt", "review"]);
  expect(rows.filter(row => row.offer_price_micro_usdc)).toHaveLength(1);
  expect(rows.find(row => row.record_type === "offer")).toMatchObject({ offer_price_micro_usdc: "999999999", selected: "true",
    offer_hash: procurementOfferHash(input.offers[0]), offer_request_hash: procurementRequestHash(input.request) });
  expect(rows[0]).toMatchObject({ maximum_quote_micro_usdc: "1000000000", planned_quote_micro_usdc: "999999999", remaining_quote_micro_usdc: "1" });
  expect(rows.find(row => row.record_type === "delivery_excerpt")).toMatchObject({ provider_declared_stance: "refutes", stance_authority: "provider-declared",
    exact_excerpt: input.deliveries[0].body, excerpt_start_utf16: "0", excerpt_end_utf16: String(input.deliveries[0].body.length) });
  expect(rows.find(row => row.record_type === "review")).toMatchObject({ review_reason: "caller-reviewed", review_authority: "caller-declared", caller_accepted_requirement_ids: "region" });
  expect(rows.every(row => row.payment_status === "not-observed" && row.quote_budget_authority === "proposal-only")).toBe(true);
});
it.each(["markdown", "csv"])("retains rejected quotes and withholds tampered delivery bytes and stale acceptance in %s", async format => {
  const input = await fixture(); input.selectedOfferIds = [];
  input.offers.push({ ...input.offers[0], id: "tampered", nonce: "tampered", priceMicroUsdc: "1" });
  input.deliveries[0].body = "PRIVATE_TAMPERED_BODY";
  const receipt = await exportEvidenceProcurement(input, format, now);
  expect(receipt.procurement.offers[1].reason).toBe("invalid-offer-signature");
  expect(receipt.text).toContain("invalid-offer-signature"); expect(receipt.text).toContain("body-hash-mismatch");
  expect(receipt.text).toContain("unbound-review"); expect(receipt.text).not.toContain("PRIVATE_TAMPERED_BODY");
  if (format === "csv") expect(csvRows(receipt.text).find(row => row.record_type === "review")?.caller_accepted_requirement_ids).toBe("");
  else expect(receipt.text).toContain("Accepted requirements in this bound caller review: none");
});
it.each(["markdown", "csv"])("rechecks original signatures, duplicate quotes and expiry in %s", async format => {
  const input = await fixture(); input.selectedOfferIds = []; input.deliveries = []; input.reviews = [];
  input.offers.push({ ...input.offers[0] });
  const duplicate = await exportEvidenceProcurement(input, format, now);
  expect(duplicate.procurement.offers.map(row => row.reason)).toEqual(["conflicting-offer", "conflicting-offer"]);
  expect(duplicate.procurement.recommendation).toBeNull();
  input.offers.pop(); input.selectedOfferIds = [input.offers[0].id];
  const expired = await exportEvidenceProcurement(input, format, Date.parse(input.request.expiresAt));
  expect(expired.text).toContain("request-expired"); expect(expired.text).toContain("expired-offer");
  expect(expired.procurement.quoteBudget.plannedMicroUsdc).toBe("999999999");
});
it("renders Markdown injection as quoted literal prose including blank lines and list syntax", async () => {
  const input = packet(); input.request.decision = '# Forged\n\n<script>alert(1)</script>\n![image](https://evil.example)\n- [x] paid\n1. automatic';
  const { text } = await exportEvidenceProcurement(input, "markdown", now);
  expect(text).toContain("> \\# Forged\n> \n> \\<script\\>");
  expect(text).toContain("> \\!\\[image\\]\\(https\\://evil\\.example\\)");
  expect(text).toContain("> \\- \\[x\\] paid\n> 1\\. automatic");
  expect(text).not.toContain("<script>"); expect(text).not.toContain("\n# Forged");
});
it.each(["=SUM(1,2)", "+cmd", "-1", "@formula", "\t\r\n=1", "\u200b=1", "\ufeff +1"])("neutralizes spreadsheet formula prefix %j while preserving original JSON", async value => {
  const input = packet(); input.request.decision = value; input.request.requirements[0].question = 'Quoted "cell",\nsecond line';
  const { text, procurement } = await exportEvidenceProcurement(input, "csv", now), rows = csvRows(text);
  expect(rows[0].decision).toBe(`'${value}`); expect(rows[1].question).toBe(input.request.requirements[0].question);
  expect(procurement.packet.request.decision).toBe(value);
});
it.each(["markdown", "csv"])("refuses oversized expanded %s output without truncating or damaging the packet", async format => {
  const input = await fixture(); input.request.requirements = Array.from({ length: 16 }, (_, at) => ({ id: `r${at}`, question: "Question", priority: 1, status: "missing" }));
  const offer = input.offers[0]; offer.requestHash = procurementRequestHash(input.request); offer.requirementIds = input.request.requirements.map(row => row.id);
  offer.signature = await signer.signMessage({ message: procurementOfferMessage(input.request, offer) });
  const delivery = input.deliveries[0]; delivery.offerHash = procurementOfferHash(offer); delivery.body = "x".repeat(39_000);
  delivery.bodyHash = procurementBodyHash(delivery.body); delivery.excerpts = offer.requirementIds.map(requirementId => ({ requirementId, start: 0, end: delivery.body.length, stance: "supports" }));
  delivery.signature = await signer.signMessage({ message: procurementDeliveryMessage(input.request, offer, delivery) });
  input.reviews = [];
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(65_536);
  expect(delivery.body.length * 16).toBeGreaterThan(MAX_PROCUREMENT_RECEIPT_BYTES);
  await expect(exportEvidenceProcurement(input, format, now)).rejects.toThrow("output bound");
  expect((await buildEvidenceProcurement(input, now)).deliveries[0].excerpts).toHaveLength(16);
});
it.each(["\u0000", "\u001b", "\u007f", "\u0085"])("refuses actual hidden control %j but preserves JSON and literal escape prose", async control => {
  const input = packet(); input.request.decision += control;
  expect((await buildEvidenceProcurement(input, now)).packet.request.decision).toContain(control);
  for (const format of ["markdown", "csv"]) await expect(exportEvidenceProcurement(input, format, now)).rejects.toThrow("non-displayable");
  input.request.decision = String.raw`Literal \u0000 is documentation`;
  expect((await exportEvidenceProcurement(input, "csv", now)).text).toContain(input.request.decision);
});
it("rejects unknown formats and caller-derived results without inventing another JSON contract", async () => {
  expect(procurementReceiptFormat(undefined)).toBe("json"); expect(procurementReceiptFormat("json")).toBe("json");
  for (const value of [null, "", "Markdown", ["csv"], "SECRET_FORMAT"]) expect(() => procurementReceiptFormat(value)).toThrow("Invalid procurement receipt format");
  await expect(exportEvidenceProcurement(packet(), "json", now)).rejects.toThrow("original procurement JSON");
  await expect(exportEvidenceProcurement(await buildEvidenceProcurement(packet(), now), "markdown", now)).rejects.toThrow();
});
