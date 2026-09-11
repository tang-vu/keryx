import { DatabaseSync } from "node:sqlite";
import { getSqliteWithdrawalAttestation } from "../db/creator-withdrawal-attestations";
import { inspectWithdrawalApplicationDatabase } from "./withdrawal-relay-files";

/** Operator-selected existing SQLite store. No adapter initialization, migrations,
 * default path, application writes or database creation during queue recovery. */
export async function withWithdrawalApplicationStore<T>(path: string,
  operation: (store: { getCreatorWithdrawalAttestation: (id: string, owner: string) => ReturnType<typeof getSqliteWithdrawalAttestation> }) => Promise<T>) {
  const identity = await inspectWithdrawalApplicationDatabase(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (JSON.stringify(await inspectWithdrawalApplicationDatabase(path)) !== JSON.stringify(identity)) throw new Error();
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");
    // Fail before queue work if the selected file is not an initialized application store.
    db.prepare(`SELECT r.id,a.claim_id,t.transfer_id FROM creator_withdrawal_requests r
      JOIN creator_withdrawal_transfer_attempts a ON a.id=r.id
      JOIN creator_withdrawal_attestations t ON t.id=a.id LIMIT 0`).all();
    return await operation({ getCreatorWithdrawalAttestation: (id, owner) => getSqliteWithdrawalAttestation(db, id, owner) });
  } finally { db.close(); }
}
