import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { inspectWithdrawalApplicationDatabase } from "../lib/gateway/withdrawal-relay-files";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";

/** Explicit existing cohort database only. Never initialize, migrate or recreate
 * missing original/admission history during submission or recovery. */
export async function withCreatorBatchStore<T>(file: string, operation: (store: SqliteAdapter) => Promise<T>, readOnly = false) {
  const identity = await inspectWithdrawalApplicationDatabase(file);
  const guard = new DatabaseSync(file, { readOnly: true });
  try {
    guard.prepare("SELECT r.id,a.claim_id,t.transfer_id FROM creator_withdrawal_requests r JOIN creator_withdrawal_transfer_attempts a ON a.id=r.id JOIN creator_withdrawal_attestations t ON t.id=a.id LIMIT 0").all();
    guard.prepare("SELECT tx_hash FROM withdrawals LIMIT 0").all();
    assert.deepEqual(await inspectWithdrawalApplicationDatabase(file), identity);
  } finally { guard.close(); }
  const store = new SqliteAdapter(file, { readOnly });
  try { return await operation(store); } finally { store.close(); }
}
