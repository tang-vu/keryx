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

/** Read-only holdings projection: incomplete, duplicate or malformed echoes stay unknown.
 * Only addresses from this exact request chunk and domain can receive a value. */
export function gatewayHeldUsdcByChunk(value: unknown, depositors: readonly string[], domain: number): Map<string, number | null> {
  const out = new Map<string, number | null>(depositors.map(a => [a.toLowerCase(), null]));
  const body = z.object({ token: z.literal("USDC"), balances: z.array(z.unknown()).max(20) }).safeParse(value);
  if (!body.success) return out;
  const seen = new Set<string>();
  const rowSchema = z.object({ depositor: address, domain: z.literal(domain), balance: decimal, pendingBatch: decimal });
  const atomic = (s: string) => { const [whole, fraction = ""] = s.split(".");
    return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0")); };
  for (const raw of body.data.balances) {
    if (!raw || typeof raw !== "object" || !("depositor" in raw) || typeof raw.depositor !== "string") continue;
    const key = raw.depositor.toLowerCase();
    if (!out.has(key)) continue;
    if (seen.has(key)) { out.set(key, null); continue; }
    seen.add(key);
    const row = rowSchema.safeParse(raw);
    if (!row.success) continue;
    const held = atomic(row.data.balance) + atomic(row.data.pendingBatch);
    if (held <= BigInt(Number.MAX_SAFE_INTEGER)) out.set(key, Number(held) / 1_000_000);
  }
  return out;
}
