import path from "node:path";
import { loadPersistentTreasuryWallet } from "./persistent-treasury-wallet";

/** Derive the public address of the existing persistent spend key and require stored metadata to
 * agree. The key is never returned, logged, generated, or copied into acknowledgement state. */
export function readTreasurySpendWalletAddress(
  file = path.resolve(process.cwd(), "data", "spend-wallet.json"),
): string | null {
  try {
    return loadPersistentTreasuryWallet(file).address;
  } catch {
    return null;
  }
}
