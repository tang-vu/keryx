import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";
import type { Source } from "../types";

const dbFile = path.join(
  os.tmpdir(),
  `keryx-gap-intents-${Date.now()}-${process.pid}.sqlite`,
);
let db: SqliteAdapter;

const source: Source = {
  id: "source-1",
  name: "CCTP Notes",
  url: "https://example.com",
  description: "CCTP documentation",
  walletAddress: "0xAbC",
  fetchPrice: 0.01,
  tags: ["cctp"],
  authors: [{ name: "Author", walletAddress: "0xAbC", splitWeight: 1 }],
  active: true,
  verified: true,
  createdAt: "2026-07-28T00:00:00.000Z",
};

beforeEach(async () => {
  db = new SqliteAdapter(dbFile);
  await db.init();
  await db.upsertSource(source);
});

afterEach(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbFile + suffix);
    } catch {
      // already removed
    }
  }
});

describe("gap intent queue", () => {
  it("is idempotent and atomically leases an eligible source", async () => {
    const input = {
      gapId: "a".repeat(64),
      claim: "CCTP burns and mints USDC",
      question: "How does CCTP work?",
      failedQueryId: "failed-1",
      sourceId: source.id,
      sourceItemLink: "https://example.com/cctp",
      itemId: "article-1",
      contentVersion: "sha256:article-1",
      articleOfferId: "offer-1",
      ownerWallet: "0xabc",
    };
    const first = await db.createGapIntent(input);
    const second = await db.createGapIntent(input);
    expect(second.id).toBe(first.id);

    const now = Date.now();
    const leased = await db.claimGapIntent(now, 60_000);
    expect(leased).toMatchObject({
      id: first.id,
      status: "running",
      attempts: 1,
      itemId: "article-1",
      contentVersion: "sha256:article-1",
      articleOfferId: "offer-1",
    });
    expect(await db.claimGapIntent(now, 60_000)).toBeNull();
  });

  it("admits only one treasury retry per gap and owner across different posts and sources", async () => {
    const first = await db.createGapIntent({
      gapId: "e".repeat(64),
      claim: "CCTP burns and mints USDC",
      question: "How does CCTP work?",
      failedQueryId: "failed-5",
      sourceId: source.id,
      sourceItemLink: "https://example.com/cctp-1",
      ownerWallet: "0xabc",
    });
    const second = await db.createGapIntent({
      gapId: "e".repeat(64),
      claim: "CCTP burns and mints USDC",
      question: "How does CCTP work?",
      failedQueryId: "failed-5",
      sourceId: "another-source",
      sourceItemLink: "https://example.com/cctp-2",
      ownerWallet: "0xAbC",
    });

    expect(second.id).toBe(first.id);
    expect(await db.listGapIntents()).toHaveLength(1);
  });

  it("leases active coordination without confusing cached payout wallet with creator authority", async () => {
    await db.createGapIntent({
      gapId: "b".repeat(64),
      claim: "Arc finality",
      question: "How fast is Arc?",
      failedQueryId: "failed-2",
      sourceId: source.id,
      sourceItemLink: "https://example.com/arc",
      ownerWallet: "0xdef",
    });
    expect(await db.claimGapIntent(Date.now(), 60_000)).toMatchObject({
      status: "running",
      ownerWallet: "0xdef",
    });
  });

  it("records a terminal fulfilled receipt and clears its lease", async () => {
    const queued = await db.createGapIntent({
      gapId: "c".repeat(64),
      claim: "Gateway settles USDC",
      question: "How does Gateway settle?",
      failedQueryId: "failed-3",
      sourceId: source.id,
      sourceItemLink: "https://example.com/gateway",
      ownerWallet: "0xabc",
    });
    await db.claimGapIntent(Date.now(), 60_000);
    await db.finishGapIntent(queued.id, {
      status: "filled",
      retryRunId: "retry-3",
      coverage: 0.8,
      rewardUsdc: 0.025,
    });
    expect((await db.listGapIntents())[0]).toMatchObject({
      status: "filled",
      retryRunId: "retry-3",
      coverage: 0.8,
      rewardUsdc: 0.025,
    });
    expect((await db.listGapIntents())[0].leaseExpiresAt).toBeUndefined();
  });

  it("closes a stale offer without making it retryable again", async () => {
    const queued = await db.createGapIntent({
      gapId: "d".repeat(64),
      claim: "A claim another source already filled",
      question: "Is this still open?",
      failedQueryId: "failed-4",
      sourceId: source.id,
      sourceItemLink: "https://example.com/stale",
      ownerWallet: "0xabc",
    });
    await db.claimGapIntent(Date.now(), 60_000);
    await db.expireGapIntent(queued.id, "gap already closed");
    expect((await db.listGapIntents())[0]).toMatchObject({
      status: "stale",
      lastError: "gap already closed",
    });
    expect(await db.claimGapIntent(Date.now(), 60_000)).toBeNull();
  });
});
