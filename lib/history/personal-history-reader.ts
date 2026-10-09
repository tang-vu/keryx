import { createHash } from "node:crypto";
import { z } from "zod";
import { HistoryError, historyFiltersSchema, historyInputSchema, historyPageSchema, historyPositionSchema, historyRowSchema, historyWallet,
  type HistoryInput, type HistoryPosition, type PersonalHistoryStore } from "./personal-history";

const cursorSchema = z.object({ version: z.literal(1), owner: z.string(), network: z.string(), filter: z.string().regex(/^[a-f0-9]{64}$/),
  upper: historyPositionSchema, before: historyPositionSchema }).strict();
const compare = (a: HistoryPosition, b: HistoryPosition) => a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1;
/** Stable descending keyset and a first-page upper anchor; this is not a transaction snapshot. */
export async function readPersonalHistory(store: PersonalHistoryStore, owner: string, network: string, raw: HistoryInput) {
  const wallet = historyWallet(owner), input = historyInputSchema.parse(raw);
  if (network !== "eip155:5042" && network !== "eip155:5042002") throw new HistoryError("history_unavailable");
  const { cursor, limit, ...rest } = input, filters = historyFiltersSchema.parse(rest);
  const filter = createHash("sha256").update(JSON.stringify(filters)).digest("hex");
  let upper: HistoryPosition | undefined, before: HistoryPosition | undefined;
  if (cursor) {
    try {
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") !== cursor) throw new Error("Noncanonical cursor");
      const decoded = cursorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (decoded.owner !== wallet || decoded.network !== network || decoded.filter !== filter || compare(decoded.before, decoded.upper) > 0) throw new Error("Cursor binding");
      ({ upper, before } = decoded);
    } catch { throw new HistoryError("invalid_history_query"); }
  }
  let rows;
  try {
    rows = z.array(historyRowSchema).max(limit + 1).parse(await store.list(wallet, { filters, take: limit + 1, upper, before }));
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (index && compare(row, rows[index - 1]) >= 0 || upper && compare(row, upper) > 0 || before && compare(row, before) >= 0
        || filters.from && row.createdAt < filters.from || filters.to && row.createdAt > filters.to
        || filters.search !== undefined && !row.question.includes(filters.search)
        || filters.surface && (row.provenance?.surface ?? "unknown") !== filters.surface
        || filters.funding && row.funding !== filters.funding) throw new Error("Invalid storage projection");
    }
  } catch { throw new HistoryError("history_unavailable"); }
  const hasMore = rows.length > limit, pageRows = rows.slice(0, limit);
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ version: 1, owner: wallet, network, filter,
    upper: upper ?? { createdAt: rows[0].createdAt, id: rows[0].id },
    before: { createdAt: pageRows.at(-1)!.createdAt, id: pageRows.at(-1)!.id } })).toString("base64url") : null;
  return historyPageSchema.parse({ version: 1, wallet, scope: "attributed-current-store", storeNetwork: network, rows: pageRows, nextCursor });
}
