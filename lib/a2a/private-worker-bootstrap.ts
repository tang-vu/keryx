import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { BUYER_NETWORK } from "../buyer/protocol";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";
import { privateRuntimePolicy } from "./private-runtime-policy";
import { createPrivateWorker } from "./private-worker";
import type { PrivateResultSpool } from "./private-result-spool";

/** Explicit operator bootstrap only: no legacy wallet loading, key generation,
 * deposits, transfers, daemon start or public checkout activation. Returning a worker
 * is not proof of prefunding, live health or readiness to accept buyer payments. */
export function privateWorkerBootstrap(db: KeryxDB, resultSpool?: PrivateResultSpool) {
  const env = process.env;
  if (env.KERYX_PRIVATE_WORKER_ENABLED === undefined || env.KERYX_PRIVATE_WORKER_ENABLED === "0") return null;
  try {
    if (!resultSpool || env.KERYX_PRIVATE_WORKER_ENABLED !== "1" || env.KERYX_PRIVATE_RESEARCH_ENABLED !== "1"
      || config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26
      || env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== config.privateResearchReservedPayees) throw new Error();
    const key = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
    const account = privateKeyToAccount(key.parse(env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) as `0x${string}`);
    const publicAccount = privateKeyToAccount(key.parse(config.funderKey) as `0x${string}`);
    const policy = privateRuntimePolicy(env, { network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [publicAccount.address], privateTreasurySigner: account.address });
    if (!policy) throw new Error();
    return createPrivateWorker(db, { signerAddress: account.address, signer: new BatchEvmScheme(account), resultSpool,
      privateProvider: policy.provider, getGatewayBalance: async () => {
        if (config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26) throw new Error("Private Gateway network unavailable");
        const balance = await getGatewayAvailableAtomic(account.address);
        if (config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26 || balance === null)
          throw new Error("Private Gateway balance unavailable");
        return balance;
      } });
  } catch { throw new Error("Private worker configuration unavailable"); }
}
