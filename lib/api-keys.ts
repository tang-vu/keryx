/**
 * API key mint + verify utilities.
 *
 * Keys are identity + rate-limit only — callers STILL pay via x402 on every request.
 * No credit ledger, no fund custody anywhere in this file.
 *
 * Format: kx_live_<96 hex chars> (total 104 chars, 384-bit entropy suffix)
 * Storage: prefix (first 16 chars) for O(1) lookup + SHA-256 hex of full key.
 * Timing-safe compare prevents length-extension or oracle attacks.
 */

import crypto from "node:crypto";
import { z } from "zod";
import { getDb } from "./db";

/** Zod schema for the raw key string — used to validate incoming Authorization header values. */
export const ApiKeySchema = z.string().regex(/^kx_live_[0-9a-f]{96}$/, "invalid api key format");

/** Prefix length: "kx_live_" (8) + 8 more chars = 16 chars total. Enough to be unique in the DB. */
const PREFIX_LEN = 16;

/** Generate a new API key, persist it (hashed), and return the raw key ONCE. */
export async function mintApiKey(
  wallet: string,
  label?: string,
): Promise<{ rawKey: string; prefix: string; id: string }> {
  const suffix = crypto.randomBytes(48).toString("hex"); // 96 hex chars = 384 bits
  const rawKey = `kx_live_${suffix}`;
  const prefix = rawKey.slice(0, PREFIX_LEN);
  const db = await getDb();
  const { id } = await db.mintApiKey(wallet, prefix, sha256(rawKey), label);
  // Raw key is assembled here and returned ONCE. DB only stores prefix + hash.
  return { rawKey, prefix, id };
}

/**
 * Verify an incoming raw key string.
 * Returns the associated wallet address and key id, or null if invalid/revoked.
 * Does not throw — callers branch on null.
 */
export async function verifyApiKey(
  raw: string,
): Promise<{ walletAddress: string; keyId: string } | null> {
  // Validate format first (short-circuits before touching DB on garbage input).
  const parsed = ApiKeySchema.safeParse(raw);
  if (!parsed.success) return null;

  const prefix = raw.slice(0, PREFIX_LEN);
  const db = await getDb();
  return db.verifyApiKey(prefix, sha256(raw));
}

/** SHA-256 of the full raw key. ~0.01 ms — safe for per-request use. */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Timing-safe compare of two SHA-256 hex strings.
 * Both are always 64 chars (SHA-256 output is fixed-length), so the length check is
 * just a guard — the algorithm is constant-time on the digest bytes.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
