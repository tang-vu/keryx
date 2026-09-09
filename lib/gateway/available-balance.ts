import { z } from "zod";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const decimal = z.string().regex(/^(0|[1-9]\d{0,71})(\.\d{1,6})?$/);
const responseSchema = z.object({ token: z.literal("USDC"), balances: z.array(z.object({
  depositor: address, domain: z.number().int().nonnegative(), balance: decimal,
})).length(1) });

/** A missing/mismatched row is unknown. Only an explicit matching zero is a zero balance. */
export function gatewayAvailableAtomic(value: unknown, depositor: string, domain: number): bigint | null {
  const parsed = responseSchema.safeParse(value);
  if (!address.safeParse(depositor).success || !parsed.success) return null;
  const row = parsed.data.balances[0];
  if (row.depositor.toLowerCase() !== depositor.toLowerCase() || row.domain !== domain) return null;
  const [whole, fraction = ""] = row.balance.split(".");
  const atomic = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  return atomic <= BigInt(2) ** BigInt(256) - BigInt(1) ? atomic : null;
}
