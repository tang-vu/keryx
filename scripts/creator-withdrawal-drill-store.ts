import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { createSqliteStorage } from "../lib/db/storage-identity-provision";
import { validateStorageIdentity, type StorageIdentity } from "../lib/db/storage-identity";

/** Exclusive application DB creation, complete schema before any admission/POST. */
export async function withNewWithdrawalDrillStore<T>(file: string, operation: (store: SqliteAdapter) => Promise<T>, expectedIdentity: StorageIdentity) {
  const identity = validateStorageIdentity(expectedIdentity);
  if (identity.authorityMode !== "testnet-real") throw new Error("Withdrawal drill requires explicit real-testnet provenance.");
  await createSqliteStorage(file, identity);
  const store = new SqliteAdapter(file, { expectedIdentity: identity });
  try {
    await store.init();
    return await operation(store);
  } finally { store.close(); }
}
