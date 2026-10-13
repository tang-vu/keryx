import { describe, expect, it } from "vitest";
import { historyReceiptSchema, ownedInputSchema, ownedRowSchema } from "./owned-history";

// Native validation is the pre-correction oracle on pinned Node24, not a runtime dependency.
const acceptedBefore = (value: string, max: number) => value.length <= max && !value.includes("\0") && value.isWellFormed();
const samples = [
  "", "ASCII", "Tiếng Việt", "中文", "العربية", "हिन्दी", "e\u0301", "\ufffd\uffff",
  "😀𝄞", "\ud800\udc00\udbff\udfff", "\n\t\u0001\u007f", "has\0NUL",
  "\ud800", "\udbff", "\udc00", "\udfff", "\udc00\ud800", "\ud800\ud800",
  "\udc00\udc00", "\ud800A\udc00", "😀\ud800", "\udfff😀",
  "a".repeat(200), "a".repeat(201), "😀".repeat(100), "😀".repeat(101), "a".repeat(199) + "\ud800",
];
const receipt = {
  id: "receipt", queryId: "owned_unicode", kind: "citation" as const, sourceId: "source", sourceName: "Creator",
  payer: "payer", payee: "payee", amountUsdc: .000001, network: "eip155:5042002", txHash: "reference",
  settled: true, settlementStatus: "settled", createdAt: "2026-10-12T00:00:00.000Z",
};

describe("owned-history portable Unicode boundary", () => {
  it.each(samples)("preserves native search admission and original UTF-16 for %j", value => {
    const result = ownedInputSchema.safeParse({ search: value });
    expect(result.success).toBe(acceptedBefore(value, 200));
    if (result.success) expect(result.data.search).toBe(value);
  });

  it("preserves every receipt text bound, malformed refusal and integer-derived amount", () => {
    const bounds = { id: 128, sourceId: 256, sourceName: 512, payer: 128, payee: 128,
      network: 128, txHash: 256, settlementStatus: 64 } as const;
    for (const [key, max] of Object.entries(bounds)) {
      for (const value of [...samples, "a".repeat(max), "a".repeat(max + 1), "😀".repeat(max / 2), "a".repeat(max - 1) + "\ud800"]) {
        const original = { ...receipt, [key]: value }, before = JSON.stringify(original);
        const result = historyReceiptSchema.safeParse(original);
        expect(result.success, `${key} length ${value.length}`).toBe(acceptedBefore(value, max));
        if (result.success) {
          expect(result.data[key as keyof typeof bounds]).toBe(value);
          expect(result.data.amountUsdc).toBe(.000001);
        }
        expect(JSON.stringify(original)).toBe(before);
      }
    }
    expect(historyReceiptSchema.parse({ ...receipt, txHash: null }).txHash).toBeNull();
    expect(historyReceiptSchema.safeParse({ ...receipt, authorization: "not admitted" }).success).toBe(false);
  });

  it("preserves creator projection text bounds without changing micro amounts or admitting extra fields", () => {
    const creator = { sourceId: "source", name: "Creator", payee: "payee", amountMicros: 1,
      network: "eip155:5042002", reference: "reference" };
    const original = { id: "owned_unicode", question: "Original question", createdAt: receipt.createdAt,
      provenance: null, recordedSpendUsdc: .000001, recordedCreatorAllocationUsdc: .000001,
      paymentMode: "real", isFollowUp: false, ownerWallet: `0x${"a".repeat(40)}`,
      ownership: { method: "recorded", claimedAt: null }, visibility: "private", revision: 0,
      networks: ["eip155:5042002"], funding: "paid", ownSettledSpendMicros: 1,
      sponsoredSettledSpendMicros: 0, receiptsTruncated: false,
      links: { report: "/api/me/asks/owned_unicode", receipts: "/api/me/asks/owned_unicode?format=receipts",
        references: "/api/me/asks/owned_unicode?format=bibtex", privacy: "/api/me/run-privacy/owned_unicode" } };
    for (const [key, max] of Object.entries({ sourceId: 256, name: 512, payee: 128, network: 128, reference: 256 })) {
      for (const value of [...samples, "a".repeat(max), "a".repeat(max + 1)]) {
        const row = { ...original, paidCreators: [{ ...creator, [key]: value }] }, before = JSON.stringify(row);
        const result = ownedRowSchema.safeParse(row);
        expect(result.success).toBe(acceptedBefore(value, max));
        if (result.success) {
          expect(result.data.paidCreators[0].amountMicros).toBe(1);
          expect(result.data.ownSettledSpendMicros).toBe(1);
          expect(result.data.question).toBe(original.question);
        }
        expect(JSON.stringify(row)).toBe(before);
      }
    }
    expect(ownedRowSchema.safeParse({ ...original, paidCreators: [{ ...creator, privateNote: "not admitted" }] }).success).toBe(false);
    expect(ownedInputSchema.safeParse({ search: "😀", wallet: "not a selector" }).success).toBe(false);
  });
});
