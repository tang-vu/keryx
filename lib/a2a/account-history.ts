import { z } from "zod";
import type { A2aOrder } from "./order";
import { A2A_REVIEW_AFTER_MS } from "./order";
import { a2aQueryIdSchema } from "./buyer-workspace";

const cursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: a2aQueryIdSchema }).strict();
export type HistoryCursor = z.infer<typeof cursorSchema>;
export function decodeHistoryCursor(raw: string | null): HistoryCursor | undefined {
  if (raw === null) return undefined;
  if (!/^[A-Za-z0-9_-]{1,300}$/.test(raw)) throw new Error("Invalid history cursor");
  return cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
}
export function encodeHistoryCursor(order: A2aOrder) {
  return Buffer.from(JSON.stringify(cursorSchema.parse({ createdAt: order.createdAt, id: order.id }))).toString("base64url");
}

/** Allowlisted owner projection. No worker input object, payment nonce or raw receipt. */
export function accountHistoryItem(order: A2aOrder, now: number) {
  const started = order.startedAt ? Date.parse(order.startedAt) : NaN;
  const status = order.status !== "running" ? order.status : order.startedAt
    ? (!Number.isFinite(started) || now - started >= A2A_REVIEW_AFTER_MS ? "review_required" : "processing") : "queued";
  return {
    id: a2aQueryIdSchema.parse(order.id),
    question: typeof order.request?.question === "string" ? order.request.question : null,
    status, createdAt: order.createdAt, updatedAt: order.updatedAt,
    mode: order.researchMode,
    packagePriceUsdc: Number.isFinite(order.amountUsdc) && order.amountUsdc >= 0 ? order.amountUsdc : null,
  };
}
