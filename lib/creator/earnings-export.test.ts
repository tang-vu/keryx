import { describe, expect, it } from "vitest";
import type { PaymentRecord } from "../types";
import {
  EARNINGS_COLUMNS,
  buildEarningsRows,
  summariseEarnings,
  type EarningsExportRow,
} from "./earnings-export";
import { exportFilename, toCsv as writeCsv } from "./csv";

const toCsv = (rows: EarningsExportRow[]) => writeCsv(EARNINGS_COLUMNS, rows);

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    kind: "citation",
    queryId: "q1",
    sourceId: "s1",
    sourceName: "Latent Space",
    payer: "0xpayer",
    payee: "0xpayee",
    amountUsdc: 0.0001,
    network: "eip155:5042002",
    settled: true,
    createdAt: "2026-07-19T10:00:00.000Z",
    ...over,
  };
}

describe("buildEarningsRows", () => {
  it("carries the question and a resolvable dispatch link", () => {
    const rows = buildEarningsRows(
      [payment({ queryId: "abc" })],
      new Map([["abc", "Who pays for AI training data?"]]),
      "https://keryx.cc/",
    );
    expect(rows[0].question).toBe("Who pays for AI training data?");
    expect(rows[0].dispatch_url).toBe("https://keryx.cc/dispatch/abc");
  });

  it("keeps payouts whose question is unknown", () => {
    const rows = buildEarningsRows([payment()], new Map(), "https://keryx.cc");
    expect(rows).toHaveLength(1);
    expect(rows[0].question).toBe("");
  });

  it("renders micro-rewards at USDC precision, never in exponent form", () => {
    const rows = buildEarningsRows(
      [payment({ amountUsdc: 0.0000001 + 0.0000002 })],
      new Map(),
      "https://keryx.cc",
    );
    expect(rows[0].amount_usdc).toBe("0.000000");
    expect(rows[0].amount_usdc).not.toMatch(/e/i);
  });

  it("leaves weight blank for fetch tolls that carry none", () => {
    const rows = buildEarningsRows(
      [payment({ kind: "fetch", weight: undefined })],
      new Map(),
      "https://keryx.cc",
    );
    expect(rows[0].weight).toBe("");
  });
});

describe("toCsv", () => {
  it("emits the declared header in order", () => {
    expect(toCsv([]).split("\r\n")[0]).toBe(EARNINGS_COLUMNS.join(","));
  });

  it("quotes and doubles quotes inside a question", () => {
    const rows = buildEarningsRows(
      [payment()],
      new Map([["q1", 'He said "buy", then left']]),
      "https://keryx.cc",
    );
    expect(toCsv(rows)).toContain('"He said ""buy"", then left"');
  });

  it("neutralises a question a spreadsheet would run as a formula", () => {
    const rows = buildEarningsRows(
      [payment()],
      new Map([["q1", "=cmd|'/c calc'!A1"]]),
      "https://keryx.cc",
    );
    const cells = toCsv(rows);
    // Leading apostrophe: the cell is inert text. No quoting needed — it holds no comma.
    expect(cells).toContain(`,'=cmd|'/c calc'!A1,`);
    expect(cells).not.toMatch(/,=cmd/);
  });

  it("keeps a newline inside a question on one logical row", () => {
    const rows = buildEarningsRows(
      [payment()],
      new Map([["q1", "line one\nline two"]]),
      "https://keryx.cc",
    );
    const csv = toCsv(rows);
    expect(csv).toContain('"line one\nline two"');
    // header + one data record, both terminated
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
  });
});

describe("summariseEarnings", () => {
  it("splits citations from tolls and counts only settled money as settled", () => {
    const s = summariseEarnings([
      payment({ kind: "citation", amountUsdc: 0.002, createdAt: "2026-07-18T00:00:00.000Z" }),
      payment({ kind: "fetch", amountUsdc: 0.001, settled: false }),
    ]);
    expect(s.paymentCount).toBe(2);
    expect(s.citationCount).toBe(1);
    expect(s.fetchCount).toBe(1);
    expect(s.totalUsdc).toBe(0.003);
    expect(s.settledUsdc).toBe(0.002);
    expect(s.firstPaymentAt).toBe("2026-07-18T00:00:00.000Z");
    expect(s.lastPaymentAt).toBe("2026-07-19T10:00:00.000Z");
  });

  it("reports an empty ledger without dates", () => {
    const s = summariseEarnings([]);
    expect(s).toMatchObject({ paymentCount: 0, totalUsdc: 0, firstPaymentAt: null });
  });
});

describe("exportFilename", () => {
  it("strips path characters out of a source id", () => {
    expect(exportFilename("../../etc/passwd", "csv")).not.toContain("/");
    expect(exportFilename("latent-space", "json")).toMatch(
      /^keryx-earnings-latent-space-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });
});
