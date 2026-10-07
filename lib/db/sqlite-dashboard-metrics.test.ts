import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import type { PaymentRecord, QueryRun } from "../types";

const dbFile = path.join(os.tmpdir(), `keryx-dashboard-metrics-${process.pid}.sqlite`);
const db = new SqliteAdapter(dbFile);
await db.init();

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

function run(
  id: string,
  origin: "engine" | "web" | "a2a" | "mcp",
  asker?: string,
): QueryRun {
  return {
    id,
    question: id,
    budget: 0.05,
    engine: "heuristic",
    subClaims: [],
    decisions: [],
    citations: [],
    answer: "answer",
    totalSpent: 0.01,
    totalToCreators: 0.01,
    trace: [],
    createdAt: "2026-07-27T00:00:00.000Z",
    origin,
    ...(origin === "mcp" ? { mcpClient: "cursor" as const } : {}),
    durationMs: 1_500,
    paymentMode: "real",
    paymentAttempts: 1,
    settledPayments: 1,
    confidence: { level: "High", reason: "covered" },
    ...(asker ? { asker } : {}),
  };
}

function payment(
  queryId: string,
  origin: "engine" | "web" | "a2a" | "mcp",
  settled = true,
): PaymentRecord {
  return {
    id: `p-${queryId}`,
    queryId,
    origin,
    kind: "citation",
    sourceId: "source",
    sourceName: "Source",
    payer: "0xpayer",
    payee: "0xcreator",
    amountUsdc: 0.01,
    network: "eip155:5042002",
    settled,
    createdAt: "2026-07-27T00:00:01.000Z",
  };
}

describe("SQLite dashboard metrics", () => {
  it("round-trips operating fee rows, excludes them from creator leaderboard, and preserves gross settlement accounting", async () => {
    const isolated = new SqliteAdapter(":memory:");
    await isolated.init();
    try {
      await isolated.saveQueryRun(run("sponsored-fee", "web"));
      const fee = { ...payment("sponsored-fee", "web"), kind: "operating-fee" as const,
        sourceId: "keryx:operating-fee", sourceName: "Keryx operating fee", payee: "0xfounder",
        settlementStatus: "settled" as const, txHash: "circle-operating-original" };
      await isolated.recordPayment(fee);
      await isolated.recordPayment({ ...fee, id: "fee-pending", settled: false, settlementStatus: "pending", authorizationId: "original-pending", txHash: null });
      expect(await isolated.metrics()).toMatchObject({ totalPayments: 1, totalVolumeUsdc: 0.01,
        totalCreatorPayoutsUsdc: 0, creatorsEarning: 0, payingQueries: 0,
        settledOperatingFeeUsdc: 0.01, settledOperatingFeePayments: 1, pendingPaymentConfirmations: 1 });
      expect(await isolated.creatorLeaderboard()).toEqual([]);
      expect(await isolated.listCreatorPaymentAttemptsByQuery("sponsored-fee")).toHaveLength(2);
      expect(await isolated.settlementLedger()).toMatchObject([{ address: "0xfounder", paidUsdc: 0.01 }]);
    } finally { isolated.close(); }
  });
  it("persists run telemetry and excludes simulated money", async () => {
    await db.saveQueryRun(run("web-1", "web", "0xAlice"));
    await db.saveQueryRun(run("web-2", "web", "0xAlice"));
    await db.saveQueryRun(run("engine-1", "engine"));
    await db.recordPayment(payment("web-1", "web"));
    await db.recordPayment(payment("web-2", "web", false));
    await db.recordPayment(payment("engine-1", "engine"));
    await db.recordPayment({
      ...payment("web-pending", "web", false),
      settlementStatus: "pending",
      authorizationId: "nonce-pending",
    });
    await db.recordFeedback("web-1", "up");

    const metrics = await db.metrics();
    expect(metrics.recordedAccounts).toBe(0);
    expect(metrics.totalPayments).toBe(2);
    expect(metrics.totalQueries).toBe(3);
    expect(metrics.guestQuestions).toBe(0);
    expect(metrics.payingQueries).toBe(2);
    expect(metrics.feedbackTotal).toBe(1);
    expect(metrics.satisfactionRate).toBe(1);
    expect(metrics.pendingPaymentConfirmations).toBe(1);
    expect(metrics.pendingPaymentVolumeUsdc).toBe(0.01);
    const pending = (await db.listPayments(10)).find((row) => row.queryId === "web-pending");
    expect(pending).toMatchObject({
      settlementStatus: "pending",
      authorizationId: "nonce-pending",
      settled: false,
    });
    const leaderboard = await db.creatorLeaderboard();
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0].totalEarnedUsdc).toBe(0.02);
    expect(leaderboard[0].paymentCount).toBe(2);
  });

  it("persists the MCP setup channel in normalized metrics", async () => {
    await db.saveQueryRun(run("mcp-cursor", "mcp"));
    await db.recordPayment(payment("mcp-cursor", "mcp"));

    const metrics = await db.metrics();
    expect(metrics.mcpClientQueries).toEqual([
      { client: "cursor", queries: 1, payingQueries: 1 },
    ]);
  });

  it("counts indexed valid wallet accounts once across sign-ins and legacy casing", async () => {
    const wallet = `0x${"aB".repeat(20)}`;
    await db.upsertUser(wallet, "reader");
    await db.upsertUser(wallet.toLowerCase(), "creator");
    await db.upsertUser(`0x${"1".repeat(40)}`, "reader");
    const native = new DatabaseSync(dbFile);
    try {
      const insert = native.prepare(`INSERT INTO users(wallet_address,role,display_handle,first_seen_at,last_seen_at)
        VALUES (?,'reader','fixture','2026-10-05T00:00:00.000Z','2026-10-05T00:00:00.000Z')`);
      for (const address of [wallet, `0X${"AB".repeat(20)}`, "0xshort", `0x${"g".repeat(40)}`, `0x${"2".repeat(41)}`]) insert.run(address);
    } finally { native.close(); }
    const metrics = await db.metrics();
    expect(metrics.recordedAccounts).toBe(2);
    expect(metrics.totalQueries).toBe(4);
    expect(JSON.stringify(metrics)).not.toContain(wallet.toLowerCase());
  });

  it("marks a failed account-index read unavailable independently of the other metrics", async () => {
    const native = new DatabaseSync(dbFile);
    try {
      native.exec("ALTER TABLE users RENAME TO fixture_users_unavailable");
      const metrics = await db.metrics();
      expect(metrics.recordedAccounts).toBeNull();
      expect(metrics.totalQueries).toBe(4);
      expect(metrics.totalPayments).toBe(3);
    } finally {
      native.exec("ALTER TABLE fixture_users_unavailable RENAME TO users");
      native.close();
    }
  });

  it("reads persisted guest questions independently of account indexing and other origins", async () => {
    await db.saveQueryRun(run("guest-web", "web"));
    await db.saveQueryRun(run("anonymous-a2a", "a2a"));
    const metrics = await db.metrics();
    expect(metrics.totalQueries).toBe(6);
    expect(metrics.guestQuestions).toBe(1);
    expect(metrics.recordedAccounts).toBe(2);
  });
});
