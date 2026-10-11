import { createHash } from "node:crypto";
import { z } from "zod";
import { HistoryError, historyFiltersSchema, historyInputSchema, historyPositionSchema, historyRowSchema,
  historyWallet, type HistoryInput, type HistoryPosition } from "../history/personal-history";
import { parseRunProvenance } from "../research/run-provenance";
import type { QueryRun } from "../types";
import { runClaimBindingSchema, runClaimDateSchema, type RunClaimBinding } from "./contracts";

/** Private account attribution only. Neither method establishes a payer or settlement. */
export const runOwnershipSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("recorded"), claimedAt: z.null() }).strict(),
  z.object({ method: z.literal("claimed"), claimedAt: runClaimDateSchema }).strict(),
]);
export type RunOwnership = z.infer<typeof runOwnershipSchema>;
export const runOwnershipHistoryRowSchema = historyRowSchema.extend({ ownership: runOwnershipSchema });
export type RunOwnershipHistoryRow = z.infer<typeof runOwnershipHistoryRowSchema>;
export const runOwnershipHistoryQuerySchema = z.object({
  binding: runClaimBindingSchema, filters: historyFiltersSchema, take: z.number().int().min(1).max(51),
  upper: historyPositionSchema.optional(), before: historyPositionSchema.optional(),
}).strict();
export type RunOwnershipHistoryQuery = z.infer<typeof runOwnershipHistoryQuerySchema>;
export interface RunOwnershipHistoryStore {
  /** One deduped, ordered allowlist projection. No answers, original packets or claim credentials. */
  list(wallet: string, query: RunOwnershipHistoryQuery): Promise<RunOwnershipHistoryRow[]>;
  /** Owner-private detail only; the saved run is returned without rewriting any field. */
  read(wallet: string, binding: RunClaimBinding, id: string): Promise<{ run: QueryRun; ownership: RunOwnership } | null>;
}
export function requireRunOwnershipHistory(db: { readonly runOwnershipHistory?: RunOwnershipHistoryStore }): RunOwnershipHistoryStore {
  try { if (db.runOwnershipHistory) return db.runOwnershipHistory; } catch { /* No native/archive fallback. */ }
  throw new HistoryError("history_unavailable");
}
/** Validate attribution against the unchanged original, then return that same object. */
export function ownershipHistoryOriginal(raw: unknown, wallet: string, id: string, createdAt: string, ownership: RunOwnership): QueryRun {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Reflect.get(raw, "id") !== id || Reflect.get(raw, "createdAt") !== createdAt)
    throw new HistoryError("history_unavailable");
  const asker = Reflect.get(raw, "asker");
  if (ownership.method === "recorded" ? asker !== undefined && asker !== null && (typeof asker !== "string" || asker.toLowerCase() !== wallet)
    : Object.hasOwn(raw, "asker") || Object.hasOwn(raw, "originalFulfillment") || Reflect.get(raw, "askerFunded") === true || Reflect.get(raw, "fundingOwner") === "browser")
    throw new HistoryError("history_unavailable");
  historyPositionSchema.parse({ id, createdAt });
  return raw as QueryRun;
}
/** Recorded amounts describe this run, never the claimant's financial contribution. */
export function summarizeOwnershipOriginal(run: QueryRun) {
  return historyRowSchema.parse({ id: run.id, createdAt: run.createdAt, question: run.question,
    provenance: parseRunProvenance(run.provenance) ?? null, funding: run.askerFunded === true ? "browser-recorded" : "other-or-unknown",
    recordedSpendUsdc: run.totalSpent, recordedCreatorAllocationUsdc: run.totalToCreators,
    paymentMode: run.paymentMode ?? null, isFollowUp: run.parentId !== undefined && run.parentId !== null });
}
const positionCompare = (a: HistoryPosition, b: HistoryPosition) => a.createdAt === b.createdAt
  ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0 : a.createdAt < b.createdAt ? -1 : 1;
const cursorSchema = z.object({ version: z.literal(1), wallet: z.string(), binding: runClaimBindingSchema,
  filter: z.string().regex(/^[a-f0-9]{64}$/), upper: historyPositionSchema, before: historyPositionSchema }).strict();
export function validateRunOwnershipHistoryRows(raw: unknown, query: RunOwnershipHistoryQuery): RunOwnershipHistoryRow[] {
  const { upper, before, filters } = query, rows = z.array(runOwnershipHistoryRowSchema).max(query.take).parse(raw);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (index && positionCompare(row, rows[index - 1]) >= 0 || upper && positionCompare(row, upper) > 0 || before && positionCompare(row, before) >= 0
      || filters.from && row.createdAt < filters.from || filters.to && row.createdAt > filters.to
      || filters.search !== undefined && !row.question.includes(filters.search)
      || filters.surface && (row.provenance?.surface ?? "unknown") !== filters.surface || filters.funding && row.funding !== filters.funding)
      throw new HistoryError("history_unavailable");
  }
  return rows;
}
/** The cursor anchors one current-store page; it is not a historical transaction snapshot. */
export async function readRunOwnershipHistory(store: RunOwnershipHistoryStore, owner: string, rawBinding: RunClaimBinding, raw: HistoryInput) {
  const wallet = historyWallet(owner), binding = runClaimBindingSchema.parse(rawBinding), { cursor, limit, ...rest } = historyInputSchema.parse(raw);
  const filters = historyFiltersSchema.parse(rest), filter = createHash("sha256").update(JSON.stringify(filters)).digest("hex");
  let upper: HistoryPosition | undefined, before: HistoryPosition | undefined;
  if (cursor) {
    try {
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error("Noncanonical cursor");
      const decoded = cursorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (decoded.wallet !== wallet || decoded.binding.network !== binding.network || decoded.binding.origin !== binding.origin
        || decoded.filter !== filter || positionCompare(decoded.before, decoded.upper) > 0) throw new Error("Cursor binding");
      ({ upper, before } = decoded);
    } catch { throw new HistoryError("invalid_history_query"); }
  }
  let rows: RunOwnershipHistoryRow[];
  try {
    const query = { binding, filters, take: limit + 1, upper, before };
    rows = validateRunOwnershipHistoryRows(await store.list(wallet, query), query);
  } catch { throw new HistoryError("history_unavailable"); }
  const pageRows = rows.slice(0, limit), nextCursor = rows.length > limit ? Buffer.from(JSON.stringify({ version: 1, wallet, binding, filter,
    upper: upper ?? { createdAt: rows[0].createdAt, id: rows[0].id },
    before: { createdAt: pageRows.at(-1)!.createdAt, id: pageRows.at(-1)!.id } })).toString("base64url") : null;
  return { version: 1 as const, wallet, binding, scope: "ownership-current-store" as const, rows: pageRows, nextCursor };
}
