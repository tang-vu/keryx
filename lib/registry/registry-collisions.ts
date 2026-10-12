import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import type { KeryxDB } from "../db/keryx-db";
import { sameRegistryAuthority, sourceRegistryAuthoritySchema, type SourceRegistryAuthority } from "./source-registry-authority";

const idSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase());
export const registryCollisionSchema = z.object({ format: z.literal("keryx-registry-collision-v1"), status: z.literal("withheld"),
  onchainId: idSchema, sourceId: z.string().min(1).max(256), observedOrigin: sourceRegistryAuthoritySchema, retainedOrigin: sourceRegistryAuthoritySchema,
  eventName: z.enum(["SourceRegistered", "SourceUpdated", "SourceDeactivated"]),
  transactionHash: idSchema.optional(), blockNumber: z.string().regex(/^(0|[1-9]\d{0,19})$/).optional(),
}).strict();
export type RegistryCollision = z.infer<typeof registryCollisionSchema>;
type Store = Pick<KeryxDB, "getSyncState" | "setSyncState">;
export function registryCollisionKey(origin: SourceRegistryAuthority, id: string): string {
  return `keryx:registry-collision:v1:${origin.network}:${origin.address}:${origin.version}:${origin.codeHash}:${idSchema.parse(id)}`;
}
export async function readRegistryCollision(db: Pick<Store, "getSyncState">, origin: SourceRegistryAuthority, id: string): Promise<RegistryCollision | null> {
  const stored = await db.getSyncState(registryCollisionKey(origin, id));
  if (stored === null) return null;
  if (stored.length > 4096) throw new Error("Registry collision evidence exceeds its bounded scope");
  const collision = registryCollisionSchema.parse(JSON.parse(stored));
  if (collision.onchainId !== id.toLowerCase() || !sameRegistryAuthority(collision.observedOrigin, origin) || sameRegistryAuthority(collision.observedOrigin, collision.retainedOrigin))
    throw new Error("Registry collision evidence differs from its retained original");
  return collision;
}
/** Retain the first scoped collision before allowing this origin's checkpoint to advance. */
export async function retainRegistryCollision(db: Store, input: RegistryCollision): Promise<void> {
  const collision = registryCollisionSchema.parse(input), prior = await readRegistryCollision(db, collision.observedOrigin, collision.onchainId);
  if (prior) {
    if (prior.sourceId !== collision.sourceId || !sameRegistryAuthority(prior.retainedOrigin, collision.retainedOrigin))
      throw new Error("Registry collision original changed");
    return;
  }
  await db.setSyncState(registryCollisionKey(collision.observedOrigin, collision.onchainId), canonicalJson(collision));
}
