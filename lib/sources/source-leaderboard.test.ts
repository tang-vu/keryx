import { describe, expect, it, vi } from "vitest";
import { loadSourceLeaderboard, settledFeeAllocations } from "./source-leaderboard";
import type { CreatorEarnings, KeryxDB } from "../db/keryx-db";
import type { Citation, PaymentRecord, QueryRun, Source } from "../types";

const wallet = "0x1111111111111111111111111111111111111111";
const network = "eip155:5042";
const citations: Citation[] = ["duckdb", "cloudflare"].map((name, index) => ({
  marker: `S${index + 1}`, sourceId: `public:${name}`, sourceName: name,
  sourceKind: "public-reference", itemUrl: `https://${name}.example/article`, weight: 0.5, reward: 0, rationale: "retained evidence",
}));
function original() {
  const payment: PaymentRecord = { id: "fee-original", kind: "operating-fee", queryId: "run1", sourceId: "keryx:operating-fee",
    sourceName: "Keryx operating fee", amountUsdc: 0.005, payer: wallet, payee: wallet, network,
    settled: true, settlementStatus: "settled", txHash: "synthetic-test-proof-not-live", createdAt: "2026-10-14T00:00:00Z" };
  const run = { id: payment.queryId, citations, operatingFee: { policy: "public-citation-operating-fee-v1", beneficiary: wallet,
    amountUsdc: payment.amountUsdc, status: "settled", paymentId: payment.id,
    allocations: citations.map(c => ({ marker: c.marker, sourceId: c.sourceId, itemUrl: c.itemUrl!, amountUsdc: 0.0025 })) },
  } as QueryRun;
  return { payment, run };
}
function reader(payment: PaymentRecord[], run: QueryRun | null) {
  return { listPublicReferences: vi.fn(async () => []), listPaymentsBySource: vi.fn(async () => payment),
    getQueryRun: vi.fn(async () => run), runPrivacyActive: false };
}
const input = { sources: [] as Source[], earnings: [] as CreatorEarnings[], network };

describe("source leaderboard", () => {
  it("shows every catalog and creator source with zero activity and never groups shared wallets", async () => {
    const db = reader([], null);
    const sources = ["one", "two"].map(id => ({ id, name: id, walletAddress: wallet } as Source));
    const result = await loadSourceLeaderboard(db, { ...input, sources });
    expect(result.rows.filter(r => r.kind === "creator").map(r => r.sourceId)).toEqual(["one", "two"]);
    expect(result.rows.length).toBeGreaterThan(100);
    expect(result.rows.every(r => r.creatorEarnedUsdc === 0 && r.operatingFeeUsdc === 0)).toBe(true);
    expect(result.operatingFeesStatus).toBe("ready");
  });

  it("attributes one original to two sources at the same owner wallet without inventing publisher earnings", async () => {
    const { payment, run } = original();
    const db = reader([payment, payment], run);
    const result = await loadSourceLeaderboard(db, input);
    const paid = result.rows.filter(r => r.operatingFeeUsdc! > 0);
    expect(paid.map(r => [r.sourceId, r.operatingFeeUsdc, r.creatorEarnedUsdc, r.operatingFeePaymentCount, r.feeBeneficiaries])).toEqual([
      ["public:cloudflare", 0.0025, 0, 1, [wallet]], ["public:duckdb", 0.0025, 0, 1, [wallet]],
    ]);
    expect(paid.reduce((sum, row) => sum + row.operatingFeeUsdc!, 0)).toBe(payment.amountUsdc);
    expect(paid.every(row => row.href.startsWith("https://"))).toBe(true);
    expect(db.getQueryRun).toHaveBeenCalledTimes(1);
  });

  it("keeps creator rewards and per-source counts unchanged alongside the owner fee", async () => {
    const { payment, run } = original();
    const earned = { sourceId: "creator", sourceName: "Creator", walletAddress: wallet,
      totalEarnedUsdc: 0.123456, citationCount: 42, paymentCount: 44 };
    const result = await loadSourceLeaderboard(reader([payment], run), { ...input, earnings: [earned] });
    expect(result.rows.find(row => row.sourceId === "creator")).toMatchObject({ creatorEarnedUsdc: 0.123456,
      citationCount: 42, paymentCount: 44, operatingFeeUsdc: 0 });
    expect(earned.totalEarnedUsdc).toBe(0.123456);
  });

  it.each(["pending", "failed", "simulated"] as const)("does not attribute a %s payment", async settlementStatus => {
    const { payment, run } = original();
    const result = await loadSourceLeaderboard(reader([{ ...payment, settled: false, settlementStatus }], run), input);
    expect(result.rows.every(row => row.operatingFeeUsdc === 0)).toBe(true);
  });

  it("requires the selected network and actual settlement evidence", async () => {
    const { payment, run } = original();
    const db = reader([{ ...payment, network: "eip155:5042002" }, { ...payment, id: "no-proof", txHash: null }], run);
    const result = await loadSourceLeaderboard(db, input);
    expect(result.rows.every(row => row.operatingFeeUsdc === 0)).toBe(true);
    expect(db.getQueryRun).not.toHaveBeenCalled();
  });

  it.each(["missing", "amount", "payee", "payment-id", "item-url", "duplicate-marker", "synthetic"])("marks %s allocation evidence unknown", async mutation => {
    const { payment, run } = original();
    if (mutation === "amount") run.operatingFee!.allocations[0].amountUsdc = 0.002501;
    if (mutation === "payee") run.operatingFee!.beneficiary = "0x2222222222222222222222222222222222222222";
    if (mutation === "payment-id") run.operatingFee!.paymentId = "other-original";
    if (mutation === "item-url") run.operatingFee!.allocations[0].itemUrl = "https://different.example/article";
    if (mutation === "duplicate-marker") run.operatingFee!.allocations[1] = { ...run.operatingFee!.allocations[0] };
    if (mutation === "synthetic") run.citations = run.citations.map(c => ({ ...c, evidenceProvenance: "synthetic-demo" }));
    const result = await loadSourceLeaderboard(reader([payment], mutation === "missing" ? null : run), input);
    expect(result.operatingFeesStatus).toBe("incomplete");
    expect(result.rows.every(row => row.operatingFeeUsdc === null && row.operatingFeePaymentCount === null)).toBe(true);
  });

  it("reads only publicly listed originals through active privacy authority", async () => {
    const { payment, run } = original();
    const db = { ...reader([payment], run), runPrivacyActive: true,
      runPrivacy: { read: vi.fn(async () => ({ exists: true, item: { run, state: { visibility: "unlisted", erased: false } } })) } as unknown as KeryxDB["runPrivacy"] };
    const result = await loadSourceLeaderboard(db, input);
    expect(result.operatingFeesStatus).toBe("incomplete");
    expect(db.getQueryRun).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("https://duckdb.example/article");
  });

  it("does not use legacy reads when active privacy authority is unavailable", async () => {
    const { payment, run } = original(), db = { ...reader([payment], run), runPrivacyActive: true };
    const result = await loadSourceLeaderboard(db, input);
    expect(result.operatingFeesStatus).toBe("incomplete");
    expect(db.getQueryRun).not.toHaveBeenCalled();
  });

  it("reports catalog and ledger read failures as unavailable", async () => {
    const db = reader([], null);
    db.listPublicReferences.mockRejectedValue(new Error("catalog refused"));
    db.listPaymentsBySource.mockRejectedValue(new Error("ledger refused"));
    const result = await loadSourceLeaderboard(db, input);
    expect(result.catalogStatus).toBe("unavailable");
    expect(result.operatingFeesStatus).toBe("unavailable");
    expect(result.rows.every(row => row.operatingFeeUsdc === null)).toBe(true);
  });

  it("validates settlement in the allocation helper itself", () => {
    const { payment, run } = original();
    expect(settledFeeAllocations({ ...payment, settled: false }, run)).toBeNull();
  });
});
