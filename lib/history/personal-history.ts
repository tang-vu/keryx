import { z } from "zod";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { RUN_SURFACES, RUN_OWNERSHIP_METHODS } from "../research/run-provenance";

export const historyDateSchema = z.string().datetime().refine(value => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}, "Use a UTC timestamp with milliseconds");
const text = (max: number) => z.string().max(max).refine(value => isWellFormedUtf16(value) && !value.includes("\0"));
export const historyIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const historyPositionSchema = z.object({ createdAt: historyDateSchema, id: historyIdSchema }).strict();
export type HistoryPosition = z.infer<typeof historyPositionSchema>;
export const historyFiltersSchema = z.object({
  search: text(200).optional(), surface: z.enum(RUN_SURFACES).optional(),
  funding: z.enum(["browser-recorded", "other-or-unknown"]).optional(),
  from: historyDateSchema.optional(), to: historyDateSchema.optional(),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, "Date bounds are reversed");
export const historyInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(25), cursor: z.string().regex(/^[A-Za-z0-9_-]{1,1600}$/).optional(),
  search: text(200).optional(), surface: z.enum(RUN_SURFACES).optional(),
  funding: z.enum(["browser-recorded", "other-or-unknown"]).optional(),
  from: historyDateSchema.optional(), to: historyDateSchema.optional(),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, "Date bounds are reversed");
export type HistoryInput = z.input<typeof historyInputSchema>;
export type HistoryFilters = z.infer<typeof historyFiltersSchema>;
const provenance = z.object({ version: z.literal(1), surface: z.enum(RUN_SURFACES), ownershipMethod: z.enum(RUN_OWNERSHIP_METHODS) }).strict();
export const historyRowSchema = z.object({
  id: historyIdSchema, createdAt: historyDateSchema, question: text(8192),
  provenance: provenance.nullable(), funding: z.enum(["browser-recorded", "other-or-unknown"]),
  recordedSpendUsdc: z.number().finite().nonnegative(), recordedCreatorAllocationUsdc: z.number().finite().nonnegative(),
  paymentMode: z.enum(["real", "offline"]).nullable(), isFollowUp: z.boolean(),
}).strict();
export type HistoryRow = z.infer<typeof historyRowSchema>;
export const historyPageSchema = z.object({
  version: z.literal(1), wallet: z.string().regex(/^0x[0-9a-f]{40}$/),
  scope: z.literal("attributed-current-store"), storeNetwork: z.enum(["eip155:5042", "eip155:5042002"]),
  rows: z.array(historyRowSchema).max(50), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,1600}$/).nullable(),
}).strict();
export type HistoryPage = z.infer<typeof historyPageSchema>;
export const historyWallet = (value: string) => z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(value).toLowerCase();
export interface PersonalHistoryStore {
  list(wallet: string, query: { filters: HistoryFilters; take: number; upper?: HistoryPosition; before?: HistoryPosition }): Promise<HistoryRow[]>;
}
export class HistoryError extends Error {
  constructor(readonly code: "invalid_history_query" | "history_unavailable") { super(code); }
}
/** Optional ordinary capability only. Unknown sealed ports refuse before storage I/O. */
export function requirePersonalHistory(db: { readonly personalHistory?: PersonalHistoryStore }): PersonalHistoryStore {
  try { if (db.personalHistory) return db.personalHistory; } catch { /* sealed capability */ }
  throw new HistoryError("history_unavailable");
}
export function parseHistoryQuery(params: URLSearchParams): HistoryInput {
  const input: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (key in input || !["limit", "cursor", "search", "surface", "funding", "from", "to"].includes(key)) throw new HistoryError("invalid_history_query");
    input[key] = key === "limit" ? (/^[1-9][0-9]?$/.test(value) ? Number(value) : NaN) : value;
  }
  return historyInputSchema.parse(input);
}
export function historyQueryString(input: HistoryInput): string {
  const parsed = historyInputSchema.parse(input), params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed)) if (value !== undefined) params.set(key, String(value));
  return params.toString();
}
