import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";
import type { PaymentRecord, QueryRun } from "../types";

const dbFile = path.join(os.tmpdir(), `keryx-dashboard-metrics-${process.pid}.sqlite`);
const db = new SqliteAdapter(dbFile);
await db.init();

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

function run(id: string, origin: "engine" | "web" | "a2a", asker?: string): QueryRun {
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
  origin: "engine" | "web" | "a2a",
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
  it("persists run telemetry and excludes simulated money", async () => {
    await db.saveQueryRun(run("web-1", "web", "0xAlice"));
    await db.saveQueryRun(run("web-2", "web", "0xAlice"));
    await db.saveQueryRun(run("engine-1", "engine"));
    await db.recordPayment(payment("web-1", "web"));
    await db.recordPayment(payment("web-2", "web", false));
    await db.recordPayment(payment("engine-1", "engine"));
    await db.recordFeedback("web-1", "up");

    const metrics = await db.metrics();
    expect(metrics.totalPayments).toBe(2);
    expect(metrics.externalQueries).toBe(2);
    expect(metrics.externalPayingQueries).toBe(1);
    expect(metrics.returningExternalActors).toBe(1);
    expect(metrics.externalDurationSamples).toBe(2);
    expect(metrics.externalFeedbackTotal).toBe(1);
    expect(metrics.externalSatisfactionRate).toBe(1);
    const leaderboard = await db.creatorLeaderboard();
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0].totalEarnedUsdc).toBe(0.02);
    expect(leaderboard[0].paymentCount).toBe(2);
  });
});
