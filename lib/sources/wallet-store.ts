/**
 * Local keystore for generated creator wallets (data/wallets.json, gitignored).
 * Lets the demo show a creator withdrawing earnings. Public addresses live in the DB;
 * private keys never leave this file and are never committed.
 */

import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const STORE = path.resolve(process.cwd(), "data", "wallets.json");

type KeyStore = Record<string, { address: string; privateKey: string }>;

function load(): KeyStore {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf-8")) as KeyStore;
  } catch {
    return {};
  }
}

function save(store: KeyStore): void {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
}

/** Generate (or reuse) a wallet for a logical key (e.g. sourceId or sourceId:author). */
export function getOrCreateWallet(label: string): { address: string; privateKey: string } {
  const store = load();
  if (store[label]) return store[label];
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  store[label] = { address, privateKey };
  save(store);
  return store[label];
}
