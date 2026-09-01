/**
 * Durable A2A research worker. It processes one paid order at a time so the treasury's bounded
 * creator budget remains easy to audit. A claimed job is never automatically requeued: a crash
 * can be ambiguous after a downstream x402 settlement, and retrying could double-spend.
 */

import crypto from "node:crypto";
import os from "node:os";
import { config } from "../lib/config.ts";
import { getDb } from "../lib/db/index.ts";
import { runNextA2aOrder } from "../lib/a2a/run-order.ts";

const workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
let stopping = false;
let recoveryOrderId: string | null = null;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    console.log(`[a2a-worker] ${signal} received; finishing the current order before exit`);
  });
}

if (!config.sellerAddress || !config.funderKey || process.env.KERYX_FORCE_OFFLINE === "1") {
  throw new Error("real A2A treasury is unavailable; refusing to start paid research worker");
}

const db = await getDb();
console.log(`[a2a-worker] online as ${workerId}`);
await db.setSyncState(
  "a2aWorker",
  JSON.stringify({ workerId, status: "idle", orderId: null, updatedAt: new Date().toISOString() }),
);

while (!stopping) {
  try {
    if (recoveryOrderId) {
      const order = await db.getA2aOrder(recoveryOrderId);
      if (order?.status === "completed" || order?.status === "failed") {
        recoveryOrderId = null;
      } else {
        await db.setSyncState(
          "a2aWorker",
          JSON.stringify({
            workerId,
            status: "recovery_pending",
            orderId: recoveryOrderId,
            updatedAt: new Date().toISOString(),
          }),
        );
        await delay(2_000);
        continue;
      }
    }
    const outcome = await runNextA2aOrder(db, workerId, {
      expectedPayee: config.sellerAddress,
      onClaim: async (order) => {
        await db.setSyncState(
          "a2aWorker",
          JSON.stringify({
            workerId,
            status: "processing",
            orderId: order.id,
            updatedAt: new Date().toISOString(),
          }),
        );
      },
    });
    await db.setSyncState(
      "a2aWorker",
      JSON.stringify({
        workerId,
        status: outcome?.status ?? "idle",
        orderId: outcome?.id ?? null,
        updatedAt: new Date().toISOString(),
      }),
    );
    if (outcome) {
      console.log(`[a2a-worker] ${outcome.id} ${outcome.status}`);
      if (outcome.status === "recovery_pending") recoveryOrderId = outcome.id;
      continue;
    }
    await delay(1_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[a2a-worker] loop error: ${message}`);
    await delay(5_000);
  }
}

await db.setSyncState(
  "a2aWorker",
  JSON.stringify({ workerId, status: "stopped", updatedAt: new Date().toISOString() }),
).catch(() => undefined);
console.log("[a2a-worker] stopped");

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
