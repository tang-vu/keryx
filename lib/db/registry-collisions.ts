import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { registryCollisionKey, registryCollisionSchema } from "../registry/registry-collisions";
import { assertConfiguredRegistryAuthority, sameRegistryAuthority } from "../registry/source-registry-authority";

/** Native CAS preserves the first collision even when separate indexer processes race. */
export function retainSqliteRegistryCollision(db: DatabaseSync, key: string, text: string): void {
  if (text.length > 4096) throw new Error("Registry collision evidence exceeds its bounded scope");
  const collision = registryCollisionSchema.parse(JSON.parse(text));
  if (key !== registryCollisionKey(collision.observedOrigin, collision.onchainId) || sameRegistryAuthority(collision.observedOrigin, collision.retainedOrigin))
    throw new Error("Invalid scoped registry collision evidence");
  assertConfiguredRegistryAuthority(collision.observedOrigin); assertConfiguredRegistryAuthority(collision.retainedOrigin);
  db.exec("BEGIN IMMEDIATE");
  try {
    const priorRow = db.prepare("SELECT value FROM sync_state WHERE key=?").get(key);
    if (priorRow) {
      const prior = registryCollisionSchema.parse(JSON.parse(String(priorRow.value)));
      if (prior.onchainId !== collision.onchainId || prior.sourceId !== collision.sourceId ||
          !sameRegistryAuthority(prior.observedOrigin, collision.observedOrigin) || !sameRegistryAuthority(prior.retainedOrigin, collision.retainedOrigin))
        throw new Error("Registry collision original changed");
    } else {
      db.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)").run(key, canonicalJson(collision), new Date().toISOString());
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
