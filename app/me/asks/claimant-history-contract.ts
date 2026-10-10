import { z } from "zod";
import { historyDateSchema, historyIdSchema, historyRowSchema } from "@/lib/history/personal-history";
import { runClaimBindingSchema, runClaimDateSchema } from "@/lib/run-claims/contracts";
import { isWellFormedUtf16 } from "@/lib/llm/well-formed-utf16";

// The server history service imports node:crypto. Only browser-safe primitives
// are imported here; these validators project its existing private HTTP DTO.
const ownership = z.discriminatedUnion("method", [
  z.object({ method: z.literal("recorded"), claimedAt: z.null() }).strict(),
  z.object({ method: z.literal("claimed"), claimedAt: runClaimDateSchema }).strict(),
]);
const row = historyRowSchema.extend({ ownership });
const wallet = z.string().regex(/^0x[0-9a-f]{40}$/);
const pageSchema = z.object({ version: z.literal(1), wallet, binding: runClaimBindingSchema,
  scope: z.literal("ownership-current-store"), rows: z.array(row).max(25),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,1600}$/).nullable(),
}).strict();
const text = (max: number) => z.string().max(max).refine(value => isWellFormedUtf16(value) && !value.includes("\0"));
const detailSchema = z.object({ version: z.literal(1), wallet, binding: runClaimBindingSchema, ownership,
  // Strip the remaining original fields; do not retain credentials, payer data,
  // exports, trace packets or arbitrary fields in component state.
  run: z.object({ id: historyIdSchema, createdAt: historyDateSchema, question: text(8192), answer: text(4_000_000),
    citations: z.array(z.object({ marker: text(128), sourceName: text(8192) })).max(200),
  }),
}).strict();
export type ClaimantHistoryPage = z.infer<typeof pageSchema>;
export type ClaimantHistoryRow = ClaimantHistoryPage["rows"][number];
export type ClaimantHistoryDetail = z.infer<typeof detailSchema>;
// Ordinary history admits originals up to 4,000,000 bytes. Allow that original
// plus a bounded ownership/binding envelope rather than dropping a valid run.
export const CLAIMANT_HISTORY_DETAIL_MAX_BYTES = 4_016_384;
export interface HistoryDisplayIdentity { owner: string; network: string; origin: string }
function verifyIdentity(value: { wallet: string; binding: { network: string; origin: string } }, identity: HistoryDisplayIdentity) {
  if (value.wallet !== identity.owner || value.binding.network !== identity.network || value.binding.origin !== identity.origin)
    throw new Error("Private history identity differs");
}
export function parseClaimantHistoryPage(raw: unknown, identity: HistoryDisplayIdentity): ClaimantHistoryPage {
  const page = pageSchema.parse(raw); verifyIdentity(page, identity);
  const ids = new Set<string>();
  for (let index = 0; index < page.rows.length; index++) {
    const item = page.rows[index], previous = page.rows[index - 1];
    if (ids.has(item.id) || previous && (item.createdAt > previous.createdAt || item.createdAt === previous.createdAt && item.id >= previous.id))
      throw new Error("Private history page order differs");
    ids.add(item.id);
  }
  return page;
}
export function parseClaimantHistoryDetail(raw: unknown, identity: HistoryDisplayIdentity, selected: ClaimantHistoryRow): ClaimantHistoryDetail {
  const detail = detailSchema.parse(raw); verifyIdentity(detail, identity);
  if (detail.run.id !== selected.id || detail.run.createdAt !== selected.createdAt || detail.run.question !== selected.question
    || detail.ownership.method !== selected.ownership.method || detail.ownership.claimedAt !== selected.ownership.claimedAt)
    throw new Error("Private saved original differs");
  return detail;
}
