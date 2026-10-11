import { z } from "zod";
import { paperRecordSchema } from "../papers/types";
import type { EncryptedEnvelope } from "../ipfs/content-crypto";

export const zoteroKeySchema = z.string().regex(/^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/);
export const zoteroTokenSchema = z.string().regex(/^[A-Za-z0-9]{24}$/);
export const zoteroConnectSchema = z.object({ apiKey: zoteroTokenSchema }).strict();
export const zoteroSendSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("papers"), collection: zoteroKeySchema, papers: paperRecordSchema.array().min(1).max(50) }).strict(),
  z.object({ kind: z.literal("report"), collection: zoteroKeySchema, reportId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict(),
]);
export const zoteroStatusSchema = z.object({ connected: z.boolean(), userId: z.string().regex(/^[1-9]\d{0,14}$/).nullable() }).strict();
export const zoteroCollectionsSchema = z.array(z.object({ key: zoteroKeySchema, name: z.string().min(1).max(256) }).strict()).max(1000);
export type ZoteroSend = z.infer<typeof zoteroSendSchema>;
export type ZoteroCode = "zotero_unavailable" | "zotero_disconnected" | "zotero_busy" | "zotero_scopes" | "zotero_backoff" | "zotero_conflict" | "zotero_library_bound" | "zotero_limit" | "zotero_provider" | "zotero_report_not_found";
export class ZoteroError extends Error {
  constructor(readonly code: ZoteroCode) { super(code); }
}
export function zoteroOwner(value: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new ZoteroError("zotero_unavailable");
  return value.toLowerCase();
}
export interface ZoteroLease {
  owner: string; generation: string; lease: string; userId: string | null; encrypted: EncryptedEnvelope | null;
}
/** Optional ordinary store. No sync-state, sealed-storage or in-memory fallback. */
export interface ZoteroStore {
  status(owner: string): Promise<z.infer<typeof zoteroStatusSchema>>;
  acquire(owner: string, connected: boolean): Promise<ZoteroLease>;
  check(lease: ZoteroLease): Promise<void>;
  connect(lease: ZoteroLease, userId: string, encrypted: EncryptedEnvelope): Promise<void>;
  revoke(owner: string): Promise<void>;
  release(lease: ZoteroLease): Promise<void>;
  backoff(lease: ZoteroLease, until: number): Promise<void>;
  key(lease: ZoteroLease, userId: string, identity: string, existing?: string): Promise<string>;
}
