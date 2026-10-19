import { z } from "zod";

export const CIRCLE_RECOVERY_PAGE_SIZE = 20;
export const CIRCLE_RECOVERY_WINDOW_MS = 31 * 24 * 60 * 60_000;
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hash = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const date = z.string().datetime();
export const circleRecoveryQuerySchema = z.object({ from: date, to: date, pageAfter: z.string().uuid().optional() }).strict()
  .refine(q => Date.parse(q.to) >= Date.parse(q.from) && Date.parse(q.to) - Date.parse(q.from) <= CIRCLE_RECOVERY_WINDOW_MS, "Invalid recovery window");
export type CircleRecoveryQuery = z.infer<typeof circleRecoveryQuerySchema>;
export const circleRecoveryPageSchema = z.object({ owner: address, from: date, to: date,
  transactions: z.array(z.object({ id: z.string().uuid(), hash: hash.optional(), createdAt: date, status: z.string().min(1).max(64) }).strict()).max(CIRCLE_RECOVERY_PAGE_SIZE),
  nextPageAfter: z.string().uuid().optional(),
}).strict();
export type CircleRecoveryPage = z.infer<typeof circleRecoveryPageSchema>;

/** One bounded, owner-scoped GET. Circle metadata is a source of lookup keys only;
 * neither a failure state nor an empty/exhausted page releases a funding hold. */
export async function listCircleRecoveryTransactions(input: {
  wallet: { id: string; address: string; userId: string; blockchain: string };
  query: CircleRecoveryQuery;
  request(path: string): Promise<Record<string, unknown>>;
}) {
  const query = circleRecoveryQuerySchema.parse(input.query), { wallet } = input;
  if (Date.parse(query.to) > Date.now() + 5_000) throw new Error("Recovery window is in the future");
  const params = new URLSearchParams({ walletIds: wallet.id, blockchain: wallet.blockchain,
    txType: "OUTBOUND", from: query.from, to: query.to, pageSize: String(CIRCLE_RECOVERY_PAGE_SIZE), order: "ASC" });
  if (query.pageAfter) params.set("pageAfter", query.pageAfter);
  const data = await input.request(`transactions?${params}`);
  // Circle's Transaction contract permits these identity fields to be omitted,
  // including on partial/pending rows. Missing fields must not discard the page.
  const rows = z.array(z.object({ id: z.string().uuid(), walletId: z.string().uuid().optional(), userId: z.string().min(1).max(256).optional(),
    sourceAddress: address.optional(), blockchain: z.string(), transactionType: z.literal("OUTBOUND"),
    createDate: date, state: z.string().min(1).max(64), txHash: z.preprocess(value => value === null || value === "" ? undefined : value, hash.optional()),
  })).max(CIRCLE_RECOVERY_PAGE_SIZE).parse(data.transactions);
  const ids = new Set<string>();
  for (const row of rows) {
    const created = Date.parse(row.createDate);
    if ((row.walletId !== undefined && row.walletId !== wallet.id) || (row.userId !== undefined && row.userId !== wallet.userId) || row.blockchain !== wallet.blockchain
      || (row.sourceAddress !== undefined && row.sourceAddress.toLowerCase() !== wallet.address.toLowerCase()) || created < Date.parse(query.from)
      || created > Date.parse(query.to) || ids.has(row.id) || row.id === query.pageAfter) throw new Error("Circle recovery scope differs");
    ids.add(row.id);
  }
  return circleRecoveryPageSchema.parse({ owner: wallet.address, from: query.from, to: query.to,
    // Require a positive wallet/owner match for candidate hashes; userId alone
    // cannot identify a wallet. Every supplied identity was checked above.
    transactions: rows.map(row => ({ id: row.id,
      ...((row.walletId !== undefined || row.sourceAddress !== undefined) && row.txHash
        ? { hash: row.txHash } : {}), createdAt: row.createDate, status: row.state })),
    // A full page is conservatively incomplete; the caller must request the next
    // page. Never follow vendor-provided URLs or infer absence from pagination.
    ...(rows.length === CIRCLE_RECOVERY_PAGE_SIZE ? { nextPageAfter: rows.at(-1)!.id } : {}),
  });
}
