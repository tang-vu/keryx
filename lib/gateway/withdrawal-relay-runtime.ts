import { isAbsolute } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const RELAY_KEY = "KERYX_WITHDRAWAL_RELAY_PRIVATE_KEY";
/** Operator bootstrap only. Derive inventory from loaded keys, not address hints
 * supplied by a client. Returned signer capabilities must never enter logs/API data.
 * The isolation flag is an operator declaration, not proof of absent off-host key use. */
export function withdrawalRelayRuntime(env: Readonly<Record<string, string | undefined>>, network: string) {
  if (env.KERYX_WITHDRAWAL_RELAY_ENABLED === undefined || env.KERYX_WITHDRAWAL_RELAY_ENABLED === "0") return null;
  try {
    if (env.KERYX_WITHDRAWAL_RELAY_ENABLED !== "1" || env.KERYX_WITHDRAWAL_RELAY_ISOLATED !== "1"
      || network !== "eip155:5042002") throw new Error();
    const directory = env.KERYX_WITHDRAWAL_RELAY_DIRECTORY;
    if (!directory || !isAbsolute(directory)) throw new Error();
    const key = env[RELAY_KEY];
    if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error();
    const signer = privateKeyToAccount(key as Hex);
    if (env.KERYX_WITHDRAWAL_RELAY_ADDRESS?.toLowerCase() !== signer.address.toLowerCase()) throw new Error();
    if (!env.AGENT_FUNDER_PRIVATE_KEY && !env.BUYER_PRIVATE_KEY) throw new Error();
    if (env.KERYX_PRIVATE_RESEARCH_ENABLED === "1" && !env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) throw new Error();
    const inventory = new Set<string>();
    for (const [name, value] of Object.entries(env)) {
      if (name === RELAY_KEY || !name.endsWith("_PRIVATE_KEY") || !value) continue;
      if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error();
      inventory.add(privateKeyToAccount(value as Hex).address.toLowerCase());
    }
    for (const name of ["SELLER_ADDRESS", "KERYX_PRIVATE_TREASURY_ADDRESS", "KERYX_PRIVATE_RESEARCH_PAYEE"]) {
      const value = env[name];
      if (!value) continue;
      if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error();
      inventory.add(value.toLowerCase());
    }
    if (!inventory.size || inventory.has(signer.address.toLowerCase())) throw new Error();
    return { directory, signer, otherSigners: [...inventory] };
  } catch { throw new Error("Withdrawal relay runtime unavailable; verify isolated operator configuration"); }
}
