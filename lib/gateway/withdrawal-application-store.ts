import { DatabaseSync } from "node:sqlite";
import { getSqliteWithdrawalAttestation } from "../db/creator-withdrawal-attestations";
import { inspectWithdrawalApplicationDatabase } from "./withdrawal-relay-files";
import { getSqliteWithdrawalRequest } from "../db/creator-withdrawal-requests";
import { recordSqliteWithdrawal } from "../db/withdrawal-records";
import type { KeryxDB } from "../db/keryx-db";

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

/** Explicit operator reporting capability on an existing application store. This
 * does not initialize/migrate tables or expose payment/claim mutation methods. */
export async function withWithdrawalCashOutStore<T>(path: string,
  operation: (store: Pick<KeryxDB, "getCreatorWithdrawal" | "recordWithdrawal">) => Promise<T>) {
  const identity = await inspectWithdrawalApplicationDatabase(path);
  const db = new DatabaseSync(path);
  try {
    if (JSON.stringify(await inspectWithdrawalApplicationDatabase(path)) !== JSON.stringify(identity)) throw new Error();
    db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
    db.prepare("SELECT id,owner,data FROM creator_withdrawal_requests LIMIT 0").all();
    db.prepare("SELECT tx_hash,created_at,label,source_name,wallet,recipient,amount_usdc,network FROM withdrawals LIMIT 0").all();
    return await operation({ getCreatorWithdrawal: (id, owner) => getSqliteWithdrawalRequest(db, id, owner),
      recordWithdrawal: value => recordSqliteWithdrawal(db, value) });
  } finally { db.close(); }
}
