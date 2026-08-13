/**
 * The parity audit is the sweep that proves the cache still says what the chain says —
 * a silent false-negative here means a redirected payout goes unnoticed. These pin the
 * money-path comparisons (payout wallet, splits, price, active) and the two row-existence
 * rules: an active chain record must have a row, an inactive one legitimately may not.
 */

import { describe, it, expect } from "vitest";
import type { Hex } from "viem";
import type { Source } from "../types";
import type { OnChainRecord } from "./registry-client";
import { compareRecord, auditRegistryParity, summarize, type RegistryReader } from "./parity";

const ONCHAIN_ID = "0x162cd3f7a89f71eb96005c3f8925c14ccdfc5be95c798724615c77c0f18b94bd" as Hex;
const PAYOUT = "0xBFdD569fde6C02B4Bf245b14d829a80d1CA790c8";
const AUTHOR_A = "0xd6a2755c703E05F78C65441ecAE9Cae2907E9FF8";
const AUTHOR_B = "0x13c817F65c3B8F1F2ca63F38f7E898C9462b6322";

const record: OnChainRecord = {
  creator: PAYOUT as `0x${string}`,
  payoutWallet: PAYOUT as `0x${string}`,
  authors: [
    { wallet: AUTHOR_A as `0x${string}`, basisPoints: 6000 },
    { wallet: AUTHOR_B as `0x${string}`, basisPoints: 4000 },
  ],
  fetchPriceUsdc6: BigInt(5000),
  contentCid: "",
  tags: "payments,agents",
  active: true,
};

const row: Source = {
  id: "onchain-micropayments-digest-718c63",
  name: "Onchain Micropayments Digest",
  url: "https://example.com/digest",
  description: "A digest.",
  walletAddress: PAYOUT,
  fetchPrice: 0.005,
  tags: ["payments"],
  authors: [
    { name: "Mara Okoye", walletAddress: AUTHOR_A, splitWeight: 0.6 },
    { name: "Devin Park", walletAddress: AUTHOR_B, splitWeight: 0.4 },
  ],
  createdAt: "2026-06-18T00:00:00.000Z",
  active: true,
  verified: true,
  onchainId: ONCHAIN_ID,
};

function fakeReader(entries: { id: Hex; record: OnChainRecord }[]): RegistryReader {
  return {
    headBlock: async () => BigInt(1000),
    sourceCount: async () => BigInt(entries.length),
    sourceIdAt: async (i) => entries[Number(i)].id,
    get: async (id) => entries.find((e) => e.id === id)?.record ?? null,
  };
}

function fakeDb(rows: Source[]) {
  return {
    async getSourceByOnchainId(onchainId: string) {
      return rows.find((r) => r.onchainId?.toLowerCase() === onchainId.toLowerCase()) ?? null;
    },
    async getSyncState() {
      return "990";
    },
  };
}

describe("compareRecord", () => {
  it("finds nothing when the cache mirrors the chain", () => {
    expect(compareRecord(row, record)).toEqual([]);
  });

  it("ignores wallet casing — checksummed chain vs lowercased cache is not drift", () => {
    const lowered = {
      ...row,
      walletAddress: PAYOUT.toLowerCase(),
      authors: row.authors.map((a) => ({ ...a, walletAddress: a.walletAddress.toLowerCase() })),
    };
    expect(compareRecord(lowered, record)).toEqual([]);
  });

  it("flags a payout wallet the chain never authorized", () => {
    const issues = compareRecord({ ...row, walletAddress: AUTHOR_A }, record);
    expect(issues.map((i) => i.field)).toEqual(["payoutWallet"]);
  });

  it("flags a fetch price that drifted", () => {
    const issues = compareRecord({ ...row, fetchPrice: 0.006 }, record);
    expect(issues.map((i) => i.field)).toEqual(["fetchPrice"]);
  });

  it("flags a row still active after the creator deactivated on-chain", () => {
    // The money-path case: the agent would keep paying a source its creator withdrew.
    const issues = compareRecord(row, { ...record, active: false });
    expect(issues.map((i) => i.field)).toEqual(["active"]);
  });

  it("treats a row without an active column as active, like listSources() does", () => {
    const { active: _active, ...legacy } = row;
    expect(compareRecord(legacy as Source, record)).toEqual([]);
  });

  it("flags an author split whose share changed", () => {
    const skewed = {
      ...row,
      authors: [
        { name: "Mara Okoye", walletAddress: AUTHOR_A, splitWeight: 0.7 },
        { name: "Devin Park", walletAddress: AUTHOR_B, splitWeight: 0.3 },
      ],
    };
    expect(compareRecord(skewed, record).map((i) => i.field)).toEqual(["authors"]);
  });

  it("flags an author the chain does not know", () => {
    const extra = {
      ...row,
      authors: [...row.authors, { name: "X", walletAddress: PAYOUT, splitWeight: 0.0 }],
    };
    expect(compareRecord(extra, record).map((i) => i.field)).toEqual(["authors"]);
  });
});

describe("auditRegistryParity", () => {
  it("reads every record back and reports a clean registry", async () => {
    const report = await auditRegistryParity(
      fakeDb([row]),
      fakeReader([{ id: ONCHAIN_ID, record }]),
    );
    expect(report.chainCount).toBe(1);
    expect(report.comparedCount).toBe(1);
    expect(report.issues).toEqual([]);
    expect(report.headBlock).toBe("1000");
    expect(report.lastSyncedBlock).toBe("990");
    expect(summarize(report)).toMatchObject({
      headBlock: "1000",
      lastSyncedBlock: "990",
      issueCount: 0,
    });
  });

  it("flags an active on-chain record the cache has no row for", async () => {
    const report = await auditRegistryParity(fakeDb([]), fakeReader([{ id: ONCHAIN_ID, record }]));
    expect(report.issues).toEqual([
      { onchainId: ONCHAIN_ID, field: "row", chain: "active record", cache: "missing" },
    ]);
  });

  it("does not demand a row for a deactivated record — the indexer skips those by design", async () => {
    const report = await auditRegistryParity(
      fakeDb([]),
      fakeReader([{ id: ONCHAIN_ID, record: { ...record, active: false } }]),
    );
    expect(report.issues).toEqual([]);
  });

  it("carries field issues from every compared row", async () => {
    const otherId = ("0x" + "ab".repeat(32)) as Hex;
    const otherRow = { ...row, id: "other", onchainId: otherId, fetchPrice: 0.009 };
    const report = await auditRegistryParity(
      fakeDb([{ ...row, walletAddress: AUTHOR_B }, otherRow]),
      fakeReader([
        { id: ONCHAIN_ID, record },
        { id: otherId, record },
      ]),
    );
    expect(report.issues.map((i) => i.field).sort()).toEqual(["fetchPrice", "payoutWallet"]);
  });
});
