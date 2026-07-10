/**
 * The live registry has exactly one creator-owned source that predates it, and the next thing that
 * source's owner will do is register it. If the id is not claimed on their row first, the indexer
 * mints a second row under the hash: same name, unverified, no feed. These pin that it is claimed,
 * and that a claim never reaches a row it has no right to.
 */

import { describe, it, expect } from "vitest";
import type { Source } from "../types";
import { sameUrl, claimOnchainIdForExistingSource } from "./pre-registry-adoption";

const WALLET = "0x72cF0D122DcDA3Fcc44BcAb6cFeA176c262bc157";
const OTHER_WALLET = "0xBFdD569fde6C02B4Bf245b14d829a80d1CA790c8";
const ONCHAIN_ID = "0x162cd3f7a89f71eb96005c3f8925c14ccdfc5be95c798724615c77c0f18b94bd";

/** The one real creator source listed before the registry was switched on. */
const preRegistryRow: Source = {
  id: "conzit-labs-59ad4d",
  name: "Conzit Labs",
  url: "https://conzit.com",
  description: "A blog.",
  rssUrl: "https://conzit.com/rss.xml",
  walletAddress: WALLET,
  fetchPrice: 0.002,
  tags: ["agents"],
  authors: [{ name: "Conzit", walletAddress: WALLET, splitWeight: 1 }],
  createdAt: "2026-06-24T00:00:00.000Z",
  active: true,
  verified: true,
};

function fakeDb(rows: Source[]) {
  const table = new Map(rows.map((r) => [r.id, structuredClone(r)]));
  return {
    table,
    async listSources() {
      return [...table.values()];
    },
    async upsertSource(source: Source) {
      table.set(source.id, source);
    },
  };
}

describe("sameUrl", () => {
  it("ignores a trailing slash and letter case", () => {
    expect(sameUrl("https://conzit.com/", "https://Conzit.com")).toBe(true);
  });

  it("does not conflate different documents", () => {
    expect(sameUrl("https://conzit.com", "https://conzit.com/rss.xml")).toBe(false);
  });

  it("treats a missing or blank url as matching nothing", () => {
    expect(sameUrl(undefined, "https://conzit.com")).toBe(false);
    expect(sameUrl("  ", "  ")).toBe(false);
  });
});

describe("claiming the registry id for a source that predates it", () => {
  it("writes the id onto the creator's existing row", async () => {
    const db = fakeDb([preRegistryRow]);
    const claimed = await claimOnchainIdForExistingSource(
      db as never,
      WALLET,
      "https://conzit.com",
      ONCHAIN_ID,
    );

    expect(claimed?.id).toBe(preRegistryRow.id);
    expect(db.table.get(preRegistryRow.id)!.onchainId).toBe(ONCHAIN_ID);
    // The row already proved feed ownership; registering on-chain must not take that back.
    expect(db.table.get(preRegistryRow.id)!.verified).toBe(true);
    expect(db.table.size).toBe(1);
  });

  it("matches the feed url too, since that is what a feed-listed source registers under", async () => {
    const db = fakeDb([preRegistryRow]);
    const claimed = await claimOnchainIdForExistingSource(
      db as never,
      WALLET,
      "https://conzit.com/rss.xml",
      ONCHAIN_ID,
    );
    expect(claimed?.id).toBe(preRegistryRow.id);
  });

  it("leaves another wallet's row alone", async () => {
    const db = fakeDb([preRegistryRow]);
    const claimed = await claimOnchainIdForExistingSource(
      db as never,
      OTHER_WALLET,
      "https://conzit.com",
      ONCHAIN_ID,
    );

    expect(claimed).toBeNull();
    expect(db.table.get(preRegistryRow.id)!.onchainId).toBeUndefined();
  });

  it("never overwrites an id a row already carries", async () => {
    const existing = { ...preRegistryRow, onchainId: "0xabc" };
    const db = fakeDb([existing]);
    const claimed = await claimOnchainIdForExistingSource(
      db as never,
      WALLET,
      "https://conzit.com",
      ONCHAIN_ID,
    );

    // Re-registering under a different URL is a different on-chain source; the old id stands.
    expect(claimed).toBeNull();
    expect(db.table.get(existing.id)!.onchainId).toBe("0xabc");
  });

  it("returns the same row again when the creator retries after rejecting the wallet prompt", async () => {
    // The claim lands before the transaction, so a rejected prompt leaves the id already written.
    // Everything downstream — feed items, the webhook, the id handed to /verify — keys off what
    // this returns, so a retry that came back empty would key them all by the hash instead.
    const db = fakeDb([{ ...preRegistryRow, onchainId: ONCHAIN_ID }]);
    const again = await claimOnchainIdForExistingSource(
      db as never,
      WALLET,
      "https://conzit.com",
      ONCHAIN_ID.toUpperCase().replace("0X", "0x"),
    );

    expect(again?.id).toBe(preRegistryRow.id);
    expect(again?.verified).toBe(true);
  });

  it("claims nothing on an ordinary first listing", async () => {
    const db = fakeDb([]);
    const claimed = await claimOnchainIdForExistingSource(
      db as never,
      WALLET,
      "https://brand-new.example",
      ONCHAIN_ID,
    );
    expect(claimed).toBeNull();
  });
});
