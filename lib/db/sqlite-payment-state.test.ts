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
      origin: "web",
    });

    const pending = (await db.listPayments(10)).find((row) => row.id === "x402:nonce-new");
    expect(pending).toMatchObject({
      settlementStatus: "pending",
      authorizationId: "nonce-new",
      settled: false,
      itemId: "article-1",
      itemTitle: "Exact article",
      contentVersion: "sha256:abc",
    });
    const metrics = await db.metrics();
    expect(metrics.totalPayments).toBe(1);
    expect(metrics.pendingPaymentConfirmations).toBe(1);
    expect(metrics.pendingPaymentVolumeUsdc).toBe(0.004);
  });
});
