import fs from "node:fs";
import path from "node:path";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Derive the public address of the existing persistent spend key and require stored metadata to
 * agree. The key is never returned, logged, generated, or copied into acknowledgement state. */
export function readTreasurySpendWalletAddress(
  file = path.resolve(process.cwd(), "data", "spend-wallet.json"),
): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      address?: unknown;
      privateKey?: unknown;
    };
    if (
      typeof parsed.address !== "string" ||
      !isAddress(parsed.address) ||
      typeof parsed.privateKey !== "string" ||
      !/^0x[0-9a-f]{64}$/i.test(parsed.privateKey)
    ) {
      return null;
    }
    const derived = privateKeyToAccount(parsed.privateKey as `0x${string}`).address;
    return derived.toLowerCase() === parsed.address.toLowerCase() ? derived : null;
  } catch {
    return null;
  }
}
