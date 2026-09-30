import { openVerifiedSqliteStorage } from "../db/storage-identity-connection";
import { validateStorageIdentity, type StorageIdentity } from "../db/storage-identity";
import { readRuntimeStorageDeployment, RuntimeStorageRefused } from "../db/runtime-storage-config";
import { getSqliteWithdrawalAttestation } from "../db/creator-withdrawal-attestations";
import { inspectWithdrawalApplicationDatabase } from "./withdrawal-relay-files";
import { getSqliteWithdrawalRequest } from "../db/creator-withdrawal-requests";
import { recordSqliteWithdrawal } from "../db/withdrawal-records";
import type { KeryxDB } from "../db/keryx-db";

/** Explicit expected identity is a trusted caller capability, never a request-body or stored-marker default. */
function applicationIdentity(path: string, explicit?: StorageIdentity): Readonly<StorageIdentity> {
  const expected = explicit ? validateStorageIdentity(explicit) : (() => {
    const deployment = readRuntimeStorageDeployment();
    if (deployment.backend.kind !== "sqlite" || deployment.backend.databasePath !== path) throw new RuntimeStorageRefused();
    return deployment.identity;
  })();
  if (expected.authorityMode !== "testnet-real") throw new RuntimeStorageRefused();
  return expected;
}

/** Operator-selected existing SQLite store. No adapter initialization, migrations,
 * default path, application writes or database creation during queue recovery. */
export async function withWithdrawalApplicationStore<T>(path: string,
  operation: (store: { getCreatorWithdrawalAttestation: (id: string, owner: string) => ReturnType<typeof getSqliteWithdrawalAttestation> }) => Promise<T>, expectedIdentity?: StorageIdentity) {
  const expected = applicationIdentity(path, expectedIdentity);
  const identity = await inspectWithdrawalApplicationDatabase(path);
  const connection = openVerifiedSqliteStorage(path, expected, { readOnly: true });
  const db = connection.db;
  try {
    if (JSON.stringify(await inspectWithdrawalApplicationDatabase(path)) !== JSON.stringify(identity)) throw new Error();
    // Fail before queue work if the selected file is not an initialized application store.
    db.prepare(`SELECT r.id,a.claim_id,t.transfer_id FROM creator_withdrawal_requests r
      JOIN creator_withdrawal_transfer_attempts a ON a.id=r.id
      JOIN creator_withdrawal_attestations t ON t.id=a.id LIMIT 0`).all();
    return await operation({ getCreatorWithdrawalAttestation: (id, owner) => { applicationIdentity(path, expectedIdentity); return getSqliteWithdrawalAttestation(db, id, owner); } });
  } finally { connection.close(); }
}

/** Explicit operator reporting capability on an existing application store. This
 * does not initialize/migrate tables or expose payment/claim mutation methods. */
export async function withWithdrawalCashOutStore<T>(path: string,
  operation: (store: Pick<KeryxDB, "getCreatorWithdrawal" | "recordWithdrawal">) => Promise<T>, expectedIdentity?: StorageIdentity) {
  const expected = applicationIdentity(path, expectedIdentity);
  const identity = await inspectWithdrawalApplicationDatabase(path);
  const connection = openVerifiedSqliteStorage(path, expected);
  const db = connection.db;
  try {
    if (JSON.stringify(await inspectWithdrawalApplicationDatabase(path)) !== JSON.stringify(identity)) throw new Error();
    db.prepare("SELECT id,owner,data FROM creator_withdrawal_requests LIMIT 0").all();
    db.prepare("SELECT tx_hash,created_at,label,source_name,wallet,recipient,amount_usdc,network FROM withdrawals LIMIT 0").all();
    return await operation({ getCreatorWithdrawal: (id, owner) => { applicationIdentity(path, expectedIdentity); return getSqliteWithdrawalRequest(db, id, owner); },
      recordWithdrawal: value => { applicationIdentity(path, expectedIdentity); return recordSqliteWithdrawal(db, value); } });
  } finally { connection.close(); }
}
