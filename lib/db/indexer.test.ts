/**
 * The indexer writes to the same table the agent reads payees from, so a wrong row here is a wrong
 * payout later. These pin the two things it must never do: mint a second row beside a source that
 * already exists, and leave `onchainId` unset — the payTo guard only consults the chain for rows
 * that carry one, so a row without it would have its payouts waved through unchecked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "../types";

const getRegistrySource = vi.fn();
vi.mock("@/lib/registry/registry-client", () => ({
  getRegistrySource: (id: string) => getRegistrySource(id),
  REGISTRY_ABI: [],
}));

const { applyLogs } = await import("./indexer");

const ONCHAIN_ID = "0x162cd3f7a89f71eb96005c3f8925c14ccdfc5be95c798724615c77c0f18b94bd";
const PAYOUT = "0xBFdD569fde6C02B4Bf245b14d829a80d1CA790c8";
const AUTHOR_A = "0xd6a2755c703E05F78C65441ecAE9Cae2907E9FF8";
const AUTHOR_B = "0x13c817F65c3B8F1F2ca63F38f7E898C9462b6322";

const chainRecord = {
  payoutWallet: PAYOUT,
  authors: [
    { wallet: AUTHOR_A, basisPoints: 6000 },
    { wallet: AUTHOR_B, basisPoints: 4000 },
  ],
  fetchPriceUsdc6: BigInt(5000),
  contentCid: "",
  tags: "payments,agents",
  active: true,
};

/** A source registered on Arc before this cache existed: slug id, hash in `onchainId`. */
const slugRow: Source = {
  id: "onchain-micropayments-digest-718c63",
  name: "Onchain Micropayments Digest",
  url: "https://example.com/digest",
  description: "A digest.",
  rssUrl: "https://example.com/digest/feed.xml",
  walletAddress: PAYOUT,
  fetchPrice: 0.002,
  tags: ["payments"],
  authors: [
    { name: "Mara Okoye", walletAddress: AUTHOR_A, splitWeight: 0.6 },
    { name: "Devin Park", walletAddress: AUTHOR_B, splitWeight: 0.4 },
  ],
  createdAt: "2026-06-18T00:00:00.000Z",
  active: true,
  verified: true,
  onchainId: ONCHAIN_ID,
  registerTx: "0xdeadbeef",
};

type FakeMeta = { name: string; description: string; url: string; rssUrl?: string };

function fakeDb(rows: Source[] = [], meta: Record<string, FakeMeta> = {}) {
  const table = new Map(rows.map((r) => [r.id, structuredClone(r)]));
  return {
    table,
    async getSource(id: string) { return table.get(id) ?? null; },
    async getSourceByOnchainId(onchainId: string) {
      for (const row of table.values()) {
        if (row.onchainId?.toLowerCase() === onchainId.toLowerCase()) return row;
      }
      return null;
    },
    async getSourceMeta(id: string) { return meta[id] ?? null; },
    async upsertSource(source: Source) { table.set(source.id, source); },
  };
}

const registered = (id: string, txHash = "0xabc123") => ({
  eventName: "SourceRegistered",
  args: { id },
  transactionHash: txHash,
});
const updated = (id: string) => ({ eventName: "SourceUpdated", args: { id } });
const deactivated = (id: string) => ({ eventName: "SourceDeactivated", args: { id } });

beforeEach(() => {
  getRegistrySource.mockReset();
  getRegistrySource.mockResolvedValue(chainRecord);
});

describe("a source that already has a row", () => {
  it("is updated in place, never duplicated under its hash", async () => {
    const db = fakeDb([slugRow]);
    await applyLogs([updated(ONCHAIN_ID)] as any, db as any);

    expect([...db.table.keys()]).toEqual([slugRow.id]);
    expect(db.table.get(slugRow.id)!.onchainId).toBe(ONCHAIN_ID);
  });

  it("takes payment fields from the chain and keeps the off-chain ones", async () => {
    const db = fakeDb([slugRow]);
    await applyLogs([updated(ONCHAIN_ID)] as any, db as any);
    const row = db.table.get(slugRow.id)!;

    expect(row.fetchPrice).toBe(0.005); // 5000 micro-USDC, from the chain
    expect(row.authors.map((a) => a.splitWeight)).toEqual([0.6, 0.4]);
    // rssUrl is not on-chain; losing it would silently stop this source's feed ingest.
    expect(row.rssUrl).toBe(slugRow.rssUrl);
    expect(row.name).toBe(slugRow.name);
    expect(row.createdAt).toBe(slugRow.createdAt);
    expect(row.registerTx).toBe("0xdeadbeef");
  });

  it("keeps the author names it already knew, keyed by wallet", async () => {
    const db = fakeDb([slugRow]);
    await applyLogs([updated(ONCHAIN_ID)] as any, db as any);

    expect(db.table.get(slugRow.id)!.authors.map((a) => a.name)).toEqual(["Mara Okoye", "Devin Park"]);
  });

  it("never downgrades a source that already proved feed ownership", async () => {
    const db = fakeDb([slugRow]);
    await applyLogs([updated(ONCHAIN_ID)] as any, db as any);
    expect(db.table.get(slugRow.id)!.verified).toBe(true);
  });

  it("is deactivated on its own row, not passed over", async () => {
    const db = fakeDb([slugRow]);
    await applyLogs([deactivated(ONCHAIN_ID)] as any, db as any);

    expect(db.table.size).toBe(1);
    expect(db.table.get(slugRow.id)!.active).toBe(false);
  });
});

describe("a source the cache has never seen", () => {
  it("is created under its hash, carrying the registry id and the register tx", async () => {
    const db = fakeDb([], { [ONCHAIN_ID]: { name: "New Source", description: "d", url: "https://new.example" } });
    await applyLogs([registered(ONCHAIN_ID, "0xfeed")] as any, db as any);

    const row = db.table.get(ONCHAIN_ID)!;
    expect(row.name).toBe("New Source");
    // Without onchainId the payTo guard would skip this source entirely.
    expect(row.onchainId).toBe(ONCHAIN_ID);
    expect(row.registerTx).toBe("0xfeed");
    // Registering on-chain is as permissionless as the web form — earning waits on feed proof.
    expect(row.verified).toBe(false);
  });

  it("falls back to a short non-hex name when no metadata was written", async () => {
    const db = fakeDb();
    await applyLogs([registered(ONCHAIN_ID)] as any, db as any);
    expect(db.table.get(ONCHAIN_ID)!.name).toBe("source-162cd3");
  });

  it("takes its feed from the metadata, the only place a first listing can carry one", async () => {
    // Without this the row lands feedless and /api/sources/verify checks the site's homepage for a
    // token the creator placed in the feed — so the source could never verify, and never earn.
    const meta = {
      [ONCHAIN_ID]: {
        name: "New Source",
        description: "d",
        url: "https://new.example",
        rssUrl: "https://new.example/rss.xml",
      },
    };
    const db = fakeDb([], meta);
    await applyLogs([registered(ONCHAIN_ID)] as any, db as any);

    expect(db.table.get(ONCHAIN_ID)!.rssUrl).toBe("https://new.example/rss.xml");
  });

  it("is ignored when the chain has no record for it", async () => {
    getRegistrySource.mockResolvedValue(null);
    const db = fakeDb();
    await applyLogs([registered(ONCHAIN_ID)] as any, db as any);
    expect(db.table.size).toBe(0);
  });

  it("is skipped for deactivation rather than resurrected as an empty row", async () => {
    const db = fakeDb();
    await applyLogs([deactivated(ONCHAIN_ID)] as any, db as any);
    expect(db.table.size).toBe(0);
  });
});
