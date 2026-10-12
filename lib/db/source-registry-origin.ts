import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { sourceRegistryAuthoritySchema, sameRegistryAuthority, assertConfiguredRegistryAuthority, type SourceRegistryAuthority } from "../registry/source-registry-authority";

const PREFIX = "keryx:source-registry-origin:v1:";
const idSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase());
const envelopeSchema = z.object({ format: z.literal("keryx-source-registry-origin-v1"), onchainId: idSchema,
  authority: sourceRegistryAuthoritySchema }).strict();
/** Called inside the adapter's native transaction for an immutable metadata/cache admission. */
export function bindSqliteSourceRegistryOrigin(db: DatabaseSync, onchainIdInput: string, authorityInput: SourceRegistryAuthority): SourceRegistryAuthority {
  const onchainId = idSchema.parse(onchainIdInput), authority = assertConfiguredRegistryAuthority(authorityInput);
  const retained = readSqliteSourceRegistryOrigin(db, onchainId);
  if (retained) {
    if (!sameRegistryAuthority(retained, authority)) throw new Error("Source ID already belongs to another immutable registry origin");
    return retained;
  }
  db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)")
    .run(PREFIX + onchainId, canonicalJson({ format: "keryx-source-registry-origin-v1", onchainId, authority }), new Date().toISOString());
  return authority;
}
export function readSqliteSourceRegistryOrigin(db: DatabaseSync, onchainIdInput: string): SourceRegistryAuthority | undefined {
  const parsedId = idSchema.safeParse(onchainIdInput);
  if (!parsedId.success) return undefined; // Legacy/offline metadata keys carry no registry authority.
  const onchainId = parsedId.data, row = db.prepare("SELECT value FROM sync_state WHERE key=?").get(PREFIX + onchainId);
  if (!row) return undefined;
  const envelope = envelopeSchema.parse(JSON.parse(String(row.value)));
  if (envelope.onchainId !== onchainId) throw new Error("Source registry origin journal is unavailable");
  return envelope.authority;
}
