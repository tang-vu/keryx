import { describe, expect, it } from "vitest";
import {
  findAccount,
  reconcileAccount,
  reconcileSettlement,
  summarizeSettlement,
  type LedgerAccount,
} from "./settlement-parity";

const AT = "2026-07-26T16:00:00.000Z";

function account(over: Partial<LedgerAccount> = {}): LedgerAccount {
  return {
    address: "0xBFdD569fde6C02B4Bf245b14d829a80d1CA790c8",
    label: "Onchain Micropayments Digest",
    paidUsdc: 0.405,
    paymentCount: 81,
    withdrawnUsdc: 0,
    withdrawCount: 0,
    ...over,
  };
}

describe("reconcileAccount", () => {
  it("confirms a wallet Circle holds exactly what the ledger claims", () => {
    const r = reconcileAccount(account(), 0.405);
    expect(r.verdict).toBe("confirmed");
    expect(r.owedUsdc).toBe(0.405);
    expect(r.deltaUsdc).toBe(0);
  });

  it("subtracts recorded cash-outs from what the Gateway should still hold", () => {
    const r = reconcileAccount(account({ paidUsdc: 1, withdrawnUsdc: 0.4, withdrawCount: 1 }), 0.6);
    expect(r.owedUsdc).toBe(0.6);
    expect(r.verdict).toBe("confirmed");
  });

  it("allows Circle's withdraw fee per recorded cash-out, and no more", () => {
    // Each cash-out burns a fee the ledger does not record, so the balance sits legitimately low.
    const two = account({ paidUsdc: 1, withdrawnUsdc: 0.4, withdrawCount: 2 });
    expect(reconcileAccount(two, 0.6 - 0.01).verdict).toBe("confirmed");
    // A third fee's worth of missing money is not a fee.
    expect(reconcileAccount(two, 0.6 - 0.016).verdict).toBe("short");
  });

  it("treats a balance larger than the claim as the creator's own money, not an error", () => {
    // Deposits and payments from other x402 services land in the same Gateway balance.
    const r = reconcileAccount(account(), 5);
    expect(r.verdict).toBe("surplus");
    expect(r.deltaUsdc).toBeCloseTo(4.595, 6);
  });

  it("flags only the direction that means Keryx overstated a creator's balance", () => {
    const r = reconcileAccount(account(), 0.1);
    expect(r.verdict).toBe("short");
    expect(r.deltaUsdc).toBeCloseTo(-0.305, 6);
  });

  it("reads an unanswered address as unknown, never as zero", () => {
    const r = reconcileAccount(account(), null);
    expect(r.verdict).toBe("unknown");
    expect(r.heldUsdc).toBeNull();
    expect(r.deltaUsdc).toBeNull();
  });
});

describe("reconcileSettlement", () => {
  const ledger = [
    account({ address: "0xAAa0000000000000000000000000000000000001", paidUsdc: 3, label: "A" }),
    account({ address: "0xBBb0000000000000000000000000000000000002", paidUsdc: 2, label: "B" }),
    account({ address: "0xCCc0000000000000000000000000000000000003", paidUsdc: 1, label: "C" }),
  ];

  it("matches balances case-insensitively and ranks by what is owed", () => {
    const report = reconcileSettlement(
      ledger,
      new Map([
        ["0xaaa0000000000000000000000000000000000001", 3],
        ["0xbbb0000000000000000000000000000000000002", 0.5],
        ["0xccc0000000000000000000000000000000000003", null],
      ]),
      AT,
    );
    expect(report.accounts.map((a) => a.label)).toEqual(["A", "B", "C"]);
    expect(report.counts).toEqual({ confirmed: 1, surplus: 0, short: 1, unknown: 1 });
    expect(report.owedUsdc).toBe(6);
    expect(report.issues.map((a) => a.label)).toEqual(["B"]);
  });

  it("counts only backed claims as confirmed, and never counts surplus as backing", () => {
    const report = reconcileSettlement(
      ledger,
      new Map([
        ["0xaaa0000000000000000000000000000000000001", 3], // confirmed → backs 3
        ["0xbbb0000000000000000000000000000000000002", 90], // surplus → backs its claim of 2, not 90
        ["0xccc0000000000000000000000000000000000003", null], // unknown → backs nothing
      ]),
      AT,
    );
    expect(report.confirmedUsdc).toBe(5);
    expect(report.confirmedUsdc).toBeLessThanOrEqual(report.owedUsdc);
  });

  it("drops wallets that are owed nothing — an empty balance confirms an empty claim", () => {
    const report = reconcileSettlement(
      [
        account({ address: "0xAAa0000000000000000000000000000000000001", paidUsdc: 3 }),
        account({ address: "0xDDd0000000000000000000000000000000000004", paidUsdc: 0.5, withdrawnUsdc: 0.5, withdrawCount: 1 }),
        account({ address: "0xEEe0000000000000000000000000000000000005", paidUsdc: 0 }),
      ],
      new Map([["0xaaa0000000000000000000000000000000000001", 3]]),
      AT,
    );
    expect(report.accounts).toHaveLength(1);
    expect(report.counts.unknown).toBe(0);
  });

  it("reports an address the balance sweep never mentioned as unknown", () => {
    const report = reconcileSettlement(ledger.slice(0, 1), new Map(), AT);
    expect(report.accounts[0].verdict).toBe("unknown");
  });
});

describe("summarizeSettlement", () => {
  it("keeps one row per wallet so a creator page can quote Circle's own figure", () => {
    const report = reconcileSettlement(
      [account({ address: "0xAAa0000000000000000000000000000000000001", label: "A", paidUsdc: 3 })],
      new Map([["0xaaa0000000000000000000000000000000000001", 3]]),
      AT,
    );
    const summary = summarizeSettlement(report);
    expect(summary.accounts).toEqual([
      { address: "0xAAa0000000000000000000000000000000000001", label: "A", owedUsdc: 3, heldUsdc: 3, verdict: "confirmed" },
    ]);
    // Lookups come from wallet columns elsewhere in the app, whose casing differs from the ledger's.
    expect(findAccount(summary, "0xaaa0000000000000000000000000000000000001")?.heldUsdc).toBe(3);
    expect(findAccount(summary, "0xdead")).toBeNull();
    expect(findAccount(null, "0xAAa0000000000000000000000000000000000001")).toBeNull();
  });
});
