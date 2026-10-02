import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { config } from "../config";
import { assertArcRpcChain } from "../arc-rpc-attestation";
import type { KeryxDB } from "../db/keryx-db";
import { BUYER_NETWORK } from "../buyer/protocol";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";
import { privateRuntimePolicy } from "./private-runtime-policy";
import { createPrivateWorker } from "./private-worker";
import type { PrivateResultSpool } from "./private-result-spool";
import { privateWorkerConfigurationId } from "./private-worker-configuration";
import { createPrivateReconciliation } from "./private-reconciliation";
import { createMainnetHostedGateway, mainnetHostedPolicy } from "../payments/mainnet-hosted-gateway";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";

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
    if (config.networkId === ARC_MAINNET_PROFILE.networkId) {
      const publicPolicy = mainnetHostedPolicy(db), privatePolicy = mainnetHostedPolicy(db, "private");
      const policy = privateRuntimePolicy(env, { network: config.networkId, publicSeller: config.sellerAddress,
        publicTreasurySigners: [publicPolicy.signer], privateTreasurySigner: privatePolicy.signer });
      if (!policy) throw new Error();
      const configurationId = privateWorkerConfigurationId(policy);
      const worker = createPrivateWorker(db, { signerAddress: privatePolicy.signer,
        signer: { createPaymentPayload: async () => { throw new Error("Mainnet private signing requires original execution context"); } },
        gatewayFactory: job => createMainnetHostedGateway(db, { role: "private", job }), resultSpool,
        privateProvider: policy.provider, getGatewayBalance: async () => {
          const current = mainnetHostedPolicy(db, "private");
          if (current.signer !== privatePolicy.signer) throw new Error("Private hosted policy changed");
          const balance = await getGatewayAvailableAtomic(current.signer, ARC_MAINNET_PROFILE);
          if (balance === null) throw new Error("Private Gateway balance unavailable"); return balance;
        } });
      return Object.freeze({ ...worker, configurationId, reconciliation: createPrivateReconciliation(db, privatePolicy.signer) });
    }
    const key = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
    const account = privateKeyToAccount(key.parse(env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) as `0x${string}`);
    const publicAccount = privateKeyToAccount(key.parse(config.funderKey) as `0x${string}`);
    const policy = privateRuntimePolicy(env, { network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [publicAccount.address], privateTreasurySigner: account.address });
    if (!policy) throw new Error();
    const configurationId = privateWorkerConfigurationId(policy);
    const signer = new BatchEvmScheme(account);
    const worker = createPrivateWorker(db, { signerAddress: account.address, signer: {
      createPaymentPayload: async (version, requirements) => {
        await assertArcRpcChain(config.rpcUrl);
        return signer.createPaymentPayload(version, requirements);
      },
    }, resultSpool,
      privateProvider: policy.provider, getGatewayBalance: async () => {
        if (config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26) throw new Error("Private Gateway network unavailable");
        const balance = await getGatewayAvailableAtomic(account.address);
        if (config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26 || balance === null)
          throw new Error("Private Gateway balance unavailable");
        return balance;
      } });
    return Object.freeze({ ...worker, configurationId, reconciliation: createPrivateReconciliation(db, account.address) });
  } catch { throw new Error("Private worker configuration unavailable"); }
}
