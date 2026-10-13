import { z } from "zod";
import { historyDateSchema, historyIdSchema, historyRowSchema, historyPositionSchema } from "./personal-history";
import { RUN_SURFACES } from "../research/run-provenance";
import { visibilitySchema } from "../run-privacy/contracts";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";

const wallet = z.string().regex(/^0x[a-f0-9]{40}$/);
const boundedText = (max: number) => z.string().max(max).refine(s => !s.includes("\0") && isWellFormedUtf16(s));
export const ownedFiltersShape = {
  search: boundedText(200).optional(), surface: z.enum(RUN_SURFACES).optional(),
  network: z.enum(["eip155:5042", "eip155:5042002", "unknown"]).optional(),
  funding: z.enum(["paid", "sponsored", "mixed", "unknown"]).optional(), visibility: visibilitySchema.optional(),
  from: historyDateSchema.optional(), to: historyDateSchema.optional(),
};
export const ownedInputSchema = z.object({ ...ownedFiltersShape, limit: z.number().int().min(1).max(50).default(25),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,3000}$/).optional() }).strict()
  .refine(v => !v.from || !v.to || v.from <= v.to, "Date bounds are reversed");
export type OwnedHistoryInput = z.input<typeof ownedInputSchema>;
/** Consumer port for #267. A backend must prove CURRENT membership for this verified wallet.
 * Absence supports only that wallet. Never infer membership from profiles, chat labels or addresses. */
export const historyMembershipSchema = z.object({ accountId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), wallets: z.array(wallet).min(1).max(8) }).strict();
export interface HistoryMembershipStore { resolve(verifiedWallet: string): Promise<z.infer<typeof historyMembershipSchema> | null> }
export const historyReceiptSchema = z.object({
  id: boundedText(128), queryId: historyIdSchema, kind: z.enum(["fetch", "citation", "inbound", "operating-fee"]),
  sourceId: boundedText(256), sourceName: boundedText(512), payer: boundedText(128), payee: boundedText(128),
  amountUsdc: z.number().finite().nonnegative(), network: boundedText(128), txHash: boundedText(256).nullable(),
  settled: z.boolean(), settlementStatus: boundedText(64), createdAt: historyDateSchema,
}).strict();
export type HistoryReceipt = z.infer<typeof historyReceiptSchema>;
const micros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const ownedRowSchema = historyRowSchema.omit({ funding: true }).extend({
  ownerWallet: wallet, ownership: z.discriminatedUnion("method", [z.object({ method: z.literal("recorded"), claimedAt: z.null() }).strict(),
    z.object({ method: z.literal("claimed"), claimedAt: historyDateSchema }).strict()]), visibility: visibilitySchema, revision: z.number().int().nonnegative(),
  networks: z.array(z.enum(["eip155:5042", "eip155:5042002"])).max(2),
  funding: z.enum(["paid", "sponsored", "mixed", "unknown"]),
  ownSettledSpendMicros: micros, sponsoredSettledSpendMicros: micros, receiptsTruncated: z.boolean(),
  paidCreators: z.array(z.object({ sourceId: boundedText(256), name: boundedText(512), payee: boundedText(128),
    amountMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), network: boundedText(128), reference: boundedText(256) }).strict()).max(200),
  links: z.object({ report: z.string(), receipts: z.string(), references: z.string(), privacy: z.string() }).strict(),
}).strict().refine(row => row.links.report === `/api/me/asks/${row.id}` && row.links.receipts === `/api/me/asks/${row.id}?format=receipts`
  && row.links.references === `/api/me/asks/${row.id}?format=bibtex` && row.links.privacy === `/api/me/run-privacy/${row.id}`, "Bound owner action links");
export type OwnedHistoryRow = z.infer<typeof ownedRowSchema>;
export const ownedPageSchema = z.object({ version: z.literal(2), wallet, scope: z.enum(["wallet-owned-current-store", "account-owned-current-store"]),
  membershipAvailable: z.boolean(), claimsAvailable: z.boolean(), storeNetwork: z.enum(["eip155:5042", "eip155:5042002"]),
  rows: z.array(ownedRowSchema).max(50), nextCursor: z.string().max(3000).nullable(), scanLimited: z.boolean(),
}).strict();
export type OwnedHistoryPage = z.infer<typeof ownedPageSchema>;
export const ownedCursorSchema = z.object({ version: z.literal(2), authority: z.string().regex(/^[a-f0-9]{64}$/),
  filter: z.string().regex(/^[a-f0-9]{64}$/), upper: historyPositionSchema, before: historyPositionSchema }).strict();
export function parseOwnedQuery(params: URLSearchParams): OwnedHistoryInput {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(raw, key) || ![...Object.keys(ownedFiltersShape), "limit", "cursor"].includes(key)) throw new Error("Invalid history query");
    raw[key] = key === "limit" ? (/^[1-9][0-9]?$/.test(value) ? Number(value) : NaN) : value;
  }
  return ownedInputSchema.parse(raw);
}
