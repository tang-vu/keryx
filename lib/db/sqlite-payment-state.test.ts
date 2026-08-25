import { afterAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";

const dbFile = path.join(os.tmpdir(), `keryx-payment-state-${process.pid}.sqlite`);
const legacy = new DatabaseSync(dbFile);
legacy.exec(`
  CREATE TABLE payment_events (
    id TEXT PRIMARY KEY, created_at TEXT, kind TEXT, query_id TEXT, source_id TEXT,
    source_name TEXT, payer TEXT, payee TEXT, amount_usdc REAL, weight REAL,
    rationale TEXT, tx_hash TEXT, network TEXT, settled INTEGER
  );
  INSERT INTO payment_events VALUES
    ('settled-old','2026-08-01T00:00:00.000Z','citation','q1','s1','Source','payer','payee',0.01,NULL,NULL,'circle-id','eip155:5042002',1),
    ('sim-old','2026-08-01T00:00:01.000Z','fetch','q2','s1','Source','payer','payee',0.002,NULL,NULL,NULL,'eip155:5042002',0);
`);
legacy.close();

const db = new SqliteAdapter(dbFile);
await db.init();

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

describe("SQLite payment settlement state migration", () => {
  it("backfills legacy truth and round-trips a pending authorization", async () => {
    const legacyRows = await db.listPayments(10);
    expect(legacyRows.find((row) => row.id === "settled-old")?.settlementStatus).toBe(
      "settled",
    );
    expect(legacyRows.find((row) => row.id === "sim-old")?.settlementStatus).toBe(
      "simulated",
    );

    await db.recordPayment({
      id: "x402:nonce-new",
      createdAt: "2026-08-04T00:00:00.000Z",
      kind: "citation",
      queryId: "q3",
      sourceId: "s1",
      sourceName: "Source",
      itemId: "article-1",
      itemTitle: "Exact article",
      itemUrl: "https://example.test/article-1",
      contentVersion: "sha256:abc",
      itemPublishedAt: "2026-08-03T00:00:00.000Z",
      payer: "payer",
      payee: "payee",
      amountUsdc: 0.004,
      txHash: null,
      network: "eip155:5042002",
      settled: false,
      settlementStatus: "pending",
      authorizationId: "nonce-new",
      authorizationExpiresAt: "2033-05-18T03:33:20.000Z",
      origin: "web",
    });

    const pending = (await db.listPayments(10)).find((row) => row.id === "x402:nonce-new");
    expect(pending).toMatchObject({
      settlementStatus: "pending",
      authorizationId: "nonce-new",
      authorizationExpiresAt: "2033-05-18T03:33:20.000Z",
      settled: false,
      itemId: "article-1",
      itemTitle: "Exact article",
      contentVersion: "sha256:abc",
    });
    const metrics = await db.metrics();
    expect(metrics.totalPayments).toBe(1);
    expect(metrics.pendingPaymentConfirmations).toBe(1);
    expect(metrics.pendingPaymentVolumeUsdc).toBe(0.004);

    expect(await db.listPendingPayments(10)).toHaveLength(1);
    await expect(
      db.settlePendingPayment("x402:nonce-new", "wrong-nonce", "circle-wrong"),
    ).resolves.toBe(false);
    await expect(
      db.settlePendingPayment("x402:nonce-new", "nonce-new", "circle-transfer"),
    ).resolves.toBe(true);
    // A second worker racing behind the first cannot promote it twice or replace the receipt.
    await expect(
      db.settlePendingPayment("x402:nonce-new", "nonce-new", "circle-replacement"),
    ).resolves.toBe(false);

    const reconciled = (await db.listPayments(10)).find(
      (row) => row.id === "x402:nonce-new",
    );
    expect(reconciled).toMatchObject({
      settled: true,
      settlementStatus: "settled",
      txHash: "circle-transfer",
    });
    const reconciledMetrics = await db.metrics();
    expect(reconciledMetrics.totalPayments).toBe(2);
    expect(reconciledMetrics.pendingPaymentConfirmations).toBe(0);
    expect(reconciledMetrics.pendingPaymentVolumeUsdc).toBe(0);
  });

  it("fails a pending payment and releases only its live grant generation", async () => {
    const sessionId = "0xowner";
    const sessAddr = "0x1111111111111111111111111111111111111111";
    await db.upsertSessionGrant({
      sessionId,
      sessAddr,
      ownerAddr: sessionId,
      cap: 0.02,
      expiry: Date.now() + 60_000,
      txHash: "0xfund",
      grantEpoch: "epoch-live",
    });
    expect(await db.addSessionGrantSpend(sessionId, 0.006)).toBe(true);
    await db.recordPayment({
      id: "x402:failed-live",
      createdAt: "2026-08-04T00:01:00.000Z",
      kind: "fetch",
      queryId: "q4",
      sourceId: "s1",
      sourceName: "Source",
      payer: sessAddr,
      payee: "0x2222222222222222222222222222222222222222",
      amountUsdc: 0.006,
      txHash: null,
      network: "eip155:5042002",
      settled: false,
      settlementStatus: "pending",
      authorizationId: "failed-live",
      grantEpoch: "epoch-live",
    });

    await expect(
      db.failPendingPayment("x402:failed-live", "failed-live", "circle-failed"),
    ).resolves.toEqual({ resolved: true, reservationReleased: true });
    expect((await db.getSessionGrant(sessionId))?.spent).toBe(0);
    expect((await db.listPayments(20)).find((row) => row.id === "x402:failed-live"))
      .toMatchObject({ settled: false, settlementStatus: "failed", txHash: "circle-failed" });
    await expect(
      db.failPendingPayment("x402:failed-live", "failed-live", "circle-retry"),
    ).resolves.toEqual({ resolved: false, reservationReleased: false });
  });

  it("does not release a failed authorization into a recovered grant generation", async () => {
    const sessionId = "0xrecovered-owner";
    const sessAddr = "0x3333333333333333333333333333333333333333";
    await db.upsertSessionGrant({
      sessionId,
      sessAddr,
      ownerAddr: sessionId,
      cap: 0.02,
      expiry: Date.now() + 60_000,
      txHash: "0xfund-old",
      grantEpoch: "epoch-old",
    });
    expect(await db.addSessionGrantSpend(sessionId, 0.006)).toBe(true);
    await db.recordPayment({
      id: "x402:failed-old",
      createdAt: "2026-08-04T00:02:00.000Z",
      kind: "fetch",
      queryId: "q5",
      sourceId: "s1",
      sourceName: "Source",
      payer: sessAddr,
      payee: "0x4444444444444444444444444444444444444444",
      amountUsdc: 0.006,
      txHash: null,
      network: "eip155:5042002",
      settled: false,
      settlementStatus: "pending",
      authorizationId: "failed-old",
      grantEpoch: "epoch-old",
    });
    await db.upsertSessionGrant({
      sessionId,
      sessAddr,
      ownerAddr: sessionId,
      cap: 0.02,
      expiry: Date.now() + 60_000,
      txHash: "recovered",
      grantEpoch: "epoch-new",
    });
    expect(await db.addSessionGrantSpend(sessionId, 0.004)).toBe(true);

    await expect(
      db.failPendingPayment("x402:failed-old", "failed-old", "circle-failed-old"),
    ).resolves.toEqual({ resolved: true, reservationReleased: false });
    expect((await db.getSessionGrant(sessionId))?.spent).toBe(0.004);
  });
});
