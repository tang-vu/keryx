import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ownershipHistoryOriginal, runOwnershipSchema, summarizeOwnershipOriginal } from "../run-claims/history";

/** Fixed pure projections only. Trusted native opening installs these before
 * wrapping/restricting the connection; application callers acquire no function
 * registration, callback, extension, schema or write capability. */
export function installRunOwnershipFunctions(db: DatabaseSync): void {
  const maxOriginalBytes = 4_000_000;
  db.function("keryx_claim_history_sha", { deterministic: true }, value => typeof value === "string" && Buffer.byteLength(value) <= maxOriginalBytes
    ? createHash("sha256").update(value).digest("hex") : null);
  db.function("keryx_claim_history_summary", { deterministic: true }, (value, owner, id, createdAt, claimedAt) => {
    try {
      if (typeof value !== "string" || Buffer.byteLength(value) > maxOriginalBytes || typeof owner !== "string"
        || typeof id !== "string" || typeof createdAt !== "string") return null;
      const ownership = runOwnershipSchema.parse(claimedAt === null ? { method: "recorded", claimedAt: null }
        : { method: "claimed", claimedAt: new Date(Number(claimedAt)).toISOString() });
      return JSON.stringify(summarizeOwnershipOriginal(ownershipHistoryOriginal(JSON.parse(value), owner, id, createdAt, ownership)));
    } catch { return null; }
  });
}
