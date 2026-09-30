import fs from "node:fs";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";

/** Exclusive application DB creation, complete schema before any admission/POST. */
export async function withNewWithdrawalDrillStore<T>(file: string, operation: (store: SqliteAdapter) => Promise<T>) {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  const store = new SqliteAdapter(file);
  try {
    await store.init();
    return await operation(store);
  } finally { store.close(); }
}
