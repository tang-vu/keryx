import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
  .refine(value => !/^0x0{40}$/.test(value))
  .transform(value => value.toLowerCase() as `0x${string}`);
const text = (bytes: number) => z.string().refine(value => new TextEncoder().encode(value).length <= bytes);
const snapshot = z.object({
  mode: z.literal("onchain"), active: z.boolean(), fetchPrice: z.number().finite().nonnegative(),
  registryAddress: address, onchainId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase() as `0x${string}`),
  creator: address,
  current: z.object({
    payoutWallet: address,
    authors: z.array(z.object({ wallet: address, basisPoints: z.number().int().min(1).max(10000) })).max(20)
      .refine(authors => authors.length === 0 || authors.reduce((sum, a) => sum + a.basisPoints, 0) === 10000),
    fetchPriceUsdc6: z.string().regex(/^(0|[1-9][0-9]{0,19})$/)
      .refine(value => /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= BigInt("18446744073709551615")),
    contentCid: text(128), tags: text(256),
  }),
}).refine(value => value.fetchPrice === Number(value.current.fetchPriceUsdc6) / 1_000_000);

export type OnchainListingSnapshot = z.infer<typeof snapshot>;
export function parseListingSnapshot(value: unknown): OnchainListingSnapshot {
  const parsed = snapshot.safeParse(value);
  if (!parsed.success) throw new Error("Listing data is unavailable. Refresh before signing.");
  return parsed.data;
}
/** Explicit schema projects every field the full-record update can overwrite. */
export function sameListingSnapshot(previous: unknown, current: unknown): boolean {
  return JSON.stringify(parseListingSnapshot(previous)) === JSON.stringify(parseListingSnapshot(current));
}
