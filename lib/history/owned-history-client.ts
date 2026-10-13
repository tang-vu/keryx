import { z } from "zod";
import { readBoundedJson } from "../read-bounded-json";
import { ownedInputSchema, ownedPageSchema, ownedRowSchema, type OwnedHistoryInput } from "./owned-history";
import type { OwnedHistoryExport } from "./owned-history-export";
const exportSchema = z.object({ version: z.literal(2), wallet: z.string().regex(/^0x[a-f0-9]{40}$/), scope: z.enum(["wallet-owned-current-store", "account-owned-current-store"]).nullable(),
  rows: z.array(ownedRowSchema).max(1000), complete: z.boolean(), truncated: z.boolean(), nextCursor: z.string().max(3000).nullable(),
  bounds: z.object({ maxPages: z.literal(20), maxRows: z.literal(1000), maxBytes: z.literal(2097152) }).strict(), pages: z.number().int().min(0).max(20),
  claimsAvailable: z.boolean(), membershipAvailable: z.boolean(), qualification: z.string().max(512) }).strict()
  .refine(v => v.complete !== v.truncated && (!v.complete || v.nextCursor === null));
/** CLI/stdio key-only bridge; same API contract, no cookies, redirect, retry or local raw DB fallback. */
export function createOwnedHistoryClient(origin: string, key: () => string | undefined, fetcher: typeof fetch = fetch) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("Use the HTTPS origin");
  async function request(path: string, raw: OwnedHistoryInput) {
    const token = key(); if (!token || !/^kx_live_[a-f0-9]{96}$/.test(token)) throw new Error("Explicit history key required");
    const url = new URL(path, base);
    url.searchParams.set("contract", "owned");
    for (const [k,v] of Object.entries(ownedInputSchema.parse(raw))) if (v !== undefined) url.searchParams.set(k, String(v));
    const response = await fetcher(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Owned history refused"); }
    return readBoundedJson(response, 4 * 1024 * 1024);
  }
  return { read: async (input: OwnedHistoryInput = {}) => ownedPageSchema.parse(await request("/api/me/asks", input)),
    export: async (input: OwnedHistoryInput = {}) => exportSchema.parse(await request("/api/me/asks/export", input)) as OwnedHistoryExport };
}
