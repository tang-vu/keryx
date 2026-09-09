import type { KeryxDB } from "../db/keryx-db";
import { privateHistoryCursorSchema, type PrivateHistoryCursor } from "../db/private-research-intents";

/** Owner-only projection. Cursor/job identifiers belong in private response/request bodies. */
export async function privateHistoryPage(db: Pick<KeryxDB, "listPrivateResearchHistory">, payer: string, before?: PrivateHistoryCursor) {
  const rows = await db.listPrivateResearchHistory(payer, before);
  if (rows.length > 26 || rows.some(row => row.intent.submission.payment.authorization.from !== payer.toLowerCase())) throw new Error("Private history owner mismatch");
  const page = rows.slice(0, 25);
  return { format: "private-history-v1" as const, jobs: page.map(({ intent, createdAt }) => ({
    id: intent.id, createdAt, question: intent.submission.request.question,
    researchMode: intent.submission.request.researchMode, model: intent.submission.request.model,
    packageVersion: intent.submission.request.packageVersion,
    priceMicros: intent.submission.payment.authorization.value,
    // Presence is an immutable intent, not evidence of payment or execution.
    record: "private-intent" as const,
  })), nextCursor: rows.length > 25 ? privateHistoryCursorSchema.parse({ id: page[24].intent.id, createdAt: page[24].createdAt }) : null };
}
