import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { recordedMicros } from "../profiles/public-profile-projection";

/** Fixed pure aggregate only. Trusted mainnet opening installs it before SQL
 * restriction and wrapping; this provides no registration selector, callback,
 * schema, raw-handle return or financial write authority. */
export function installPublicProfileFunctions(db: DatabaseSync): void {
  db.aggregate<string | null>("keryx_public_profile_micros", { start: "0", step: (total: string | null, amount: SQLOutputValue) => {
    const micros = recordedMicros(amount); return total === null || micros === null ? null : (BigInt(total) + BigInt(micros)).toString();
  } });
}
