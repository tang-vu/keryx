/** Test-only historical TypeScript v1 writer oracle. Never import in production callers. */
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { writeBuyerFile } from "../lib/buyer/journal";
import { addressSchema, buyerRequestSchema } from "../lib/buyer/protocol";

const taskSchema = z.object({ schema: z.literal("keryx-operator-task-v1"), id: z.string().uuid(),
  createdAt: z.string().datetime(), kind: z.literal("paid_research"), request: buyerRequestSchema,
  payee: addressSchema, maxTotalMicros: z.string().regex(/^[1-9]\d{0,6}$/) }).strict();

export async function createLegacyOperatorTask(directory: string, input: {
  request: unknown; payee: string; maxTotalMicros: string; id?: string; createdAt?: string;
}) {
  const request = buyerRequestSchema.parse(input.request);
  const payee = addressSchema.parse(input.payee);
  const maxTotalMicros = z.string().regex(/^[1-9]\d{0,6}$/).parse(input.maxTotalMicros);
  const micros = BigInt(maxTotalMicros);
  if (micros > BigInt(1_000_000) || micros <= BigInt(Math.round(request.budget * 1e6))) {
    throw new Error("Total cap must exceed the creator budget and be at most 1 testnet USDC");
  }
  const task = taskSchema.parse({ schema: "keryx-operator-task-v1", id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(), kind: "paid_research", request, payee, maxTotalMicros });
  if (Buffer.byteLength(JSON.stringify(request, null, 2) + "\n") > 8192
    || Buffer.byteLength(JSON.stringify(task, null, 2) + "\n") > 8192) {
    throw new Error("Task request or metadata exceeds 8 KB");
  }
  const target = resolve(directory);
  await mkdir(target, { mode: 0o700 });
  if (process.platform !== "win32") {
    const parent = await open(dirname(target), "r");
    try { await parent.sync(); } finally { await parent.close(); }
  }
  await writeBuyerFile(target, "request.json", request);
  await writeBuyerFile(target, "task.json", task);
  return { taskId: task.id, status: "ready" as const, buyerState: join(target, "buyer") };
}
