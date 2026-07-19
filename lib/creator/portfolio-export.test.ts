import { describe, expect, it } from "vitest";
import type { PaymentRecord } from "../types";
import { toCsv } from "./csv";
import {
  PORTFOLIO_COLUMNS,
  buildPortfolioRows,
  sortNewestFirst,
  summarisePortfolioBySource,
} from "./portfolio-export";

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    kind: "citation",
    queryId: "q1",
    sourceId: "s1",
    sourceName: "Latent Space",
    payer: "0xpayer",
    payee: "0xpayee",
    amountUsdc: 0.003,
    network: "eip155:5042002",
    settled: true,
    createdAt: "2026-07-19T10:00:00.000Z",
    ...over,
  };
}

describe("buildPortfolioRows", () => {
  it("labels each payout with the source that earned it", () => {
    const rows = buildPortfolioRows(
      [payment({ sourceId: "s2", sourceName: "Stablecoin Ledger" })],
      new Map([["q1", "Who pays for training data?"]]),
      "https://keryx.cc",
    );
    expect(rows[0].source_id).toBe("s2");
    expect(rows[0].source_name).toBe("Stablecoin Ledger");
    expect(rows[0].question).toBe("Who pays for training data?");
  });

  it("stays row-aligned when payouts span sources", () => {
    const rows = buildPortfolioRows(
      [payment({ sourceId: "a", amountUsdc: 0.001 }), payment({ sourceId: "b", amountUsdc: 0.002 })],
      new Map(),
      "https://keryx.cc",
    );
    expect(rows.map((r) => [r.source_id, r.amount_usdc])).toEqual([
      ["a", "0.001000"],
      ["b", "0.002000"],
    ]);
  });

  it("writes the source columns first so a pivot reads them as keys", () => {
    const csv = toCsv(
      PORTFOLIO_COLUMNS,
      buildPortfolioRows([payment()], new Map(), "https://keryx.cc"),
    );
    expect(csv.split("\r\n")[0]).toMatch(/^source_id,source_name,date,/);
  });
});

describe("summarisePortfolioBySource", () => {
  it("groups by source, biggest earner first, settled counted separately", () => {
    const totals = summarisePortfolioBySource([
      payment({ sourceId: "small", sourceName: "Small", amountUsdc: 0.001 }),
      payment({ sourceId: "big", sourceName: "Big", amountUsdc: 0.01 }),
      payment({ sourceId: "big", sourceName: "Big", amountUsdc: 0.005, settled: false }),
    ]);
    expect(totals.map((t) => t.sourceId)).toEqual(["big", "small"]);
    expect(totals[0]).toMatchObject({ paymentCount: 2, totalUsdc: 0.015, settledUsdc: 0.01 });
  });

  it("does not accumulate float dust across many micro-rewards", () => {
    const many = Array.from({ length: 10 }, () => payment({ amountUsdc: 0.0001 }));
    expect(summarisePortfolioBySource(many)[0].totalUsdc).toBe(0.001);
  });

  it("returns nothing for an empty ledger", () => {
    expect(summarisePortfolioBySource([])).toEqual([]);
  });
});

describe("sortNewestFirst", () => {
  it("merges sources into one statement ordered by time, not by source", () => {
    const sorted = sortNewestFirst([
      payment({ sourceId: "a", createdAt: "2026-07-01T00:00:00.000Z" }),
      payment({ sourceId: "b", createdAt: "2026-07-19T00:00:00.000Z" }),
      payment({ sourceId: "a", createdAt: "2026-07-10T00:00:00.000Z" }),
    ]);
    expect(sorted.map((p) => p.createdAt.slice(0, 10))).toEqual([
      "2026-07-19",
      "2026-07-10",
      "2026-07-01",
    ]);
  });

  it("leaves the caller's array untouched", () => {
    const input = [
      payment({ createdAt: "2026-07-01T00:00:00.000Z" }),
      payment({ createdAt: "2026-07-19T00:00:00.000Z" }),
    ];
    sortNewestFirst(input);
    expect(input[0].createdAt.slice(0, 10)).toBe("2026-07-01");
  });
});
