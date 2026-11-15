import { canonicalJson } from "../canonical-json";
import { applicationStorageIdentity, assertApplicationStorageCurrentLocal } from "../db/application-storage";
import { configuredHostedTreasuryPolicy } from "../payments/hosted-treasury-policy";
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
export async function privateWorkerBootstrap(db: KeryxDB, resultSpool?: PrivateResultSpool) {
  const env = { ...process.env };
  if (env.KERYX_PRIVATE_WORKER_ENABLED === undefined || env.KERYX_PRIVATE_WORKER_ENABLED === "0") return null;
  try {
    if (!resultSpool || env.KERYX_PRIVATE_WORKER_ENABLED !== "1" || env.KERYX_PRIVATE_RESEARCH_ENABLED !== "1"
      || config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26
      || env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== config.privateResearchReservedPayees) throw new Error();
    const mainnet = config.networkId === ARC_MAINNET_PROFILE.networkId;
    const frame = () => canonicalJson({ profile: config.profile, network: config.networkId,
      cctpDomain: config.cctpDomain, seller: config.sellerAddress, reservedPayees: config.privateResearchReservedPayees,
      baseUrl: config.baseUrl, rpcUrl: config.rpcUrl, maxTimeoutSeconds: config.maxTimeoutSeconds,
      timeoutEnv: process.env.KERYX_MAX_TIMEOUT_SECONDS, forceOffline: process.env.KERYX_FORCE_OFFLINE, publicKey: mainnet ? undefined : config.funderKey });
    const capturedFrame = frame();
    const assertFrame = () => {
      if (frame() !== capturedFrame || process.env.KERYX_PRIVATE_WORKER_ENABLED !== env.KERYX_PRIVATE_WORKER_ENABLED
        || process.env.KERYX_FORCE_OFFLINE !== env.KERYX_FORCE_OFFLINE
        || process.env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES)
        throw new Error("Private worker network unavailable or configuration changed");
    };
    if (mainnet) {
      const identity = await applicationStorageIdentity(db, "write"); assertFrame();
      const publicPolicy = await mainnetHostedPolicy(db); assertFrame();
      const privatePolicy = await mainnetHostedPolicy(db, "private"); assertFrame();
      const policy = privateRuntimePolicy(env, { network: config.networkId, publicSeller: config.sellerAddress,
        publicTreasurySigners: [publicPolicy.signer], privateTreasurySigner: privatePolicy.signer });
      if (!policy) throw new Error();
      const policyWire = canonicalJson(policy);
      const assertCurrent = () => {
        assertFrame(); assertApplicationStorageCurrentLocal(db, "write");
        if (config.profile !== ARC_MAINNET_PROFILE || canonicalJson(privateRuntimePolicy(process.env, {
          network: config.networkId, publicSeller: config.sellerAddress, publicTreasurySigners: [publicPolicy.signer],
          privateTreasurySigner: privatePolicy.signer })) !== policyWire
          || canonicalJson(configuredHostedTreasuryPolicy(identity, publicPolicy.origin)) !== canonicalJson(publicPolicy)
          || canonicalJson(configuredHostedTreasuryPolicy(identity, privatePolicy.origin, "private")) !== canonicalJson(privatePolicy))
          throw new Error("Private worker authority changed");
      };
      const refresh = async () => {
        const current = await applicationStorageIdentity(db, "write");
        if (canonicalJson(current) !== canonicalJson(identity)) throw new Error("Private worker storage changed");
        assertCurrent();
      };
      assertCurrent();
      const configurationId = privateWorkerConfigurationId(policy);
      const worker = createPrivateWorker(db, { signerAddress: privatePolicy.signer,
        signer: { createPaymentPayload: async () => { throw new Error("Mainnet private signing requires original execution context"); } },
        gatewayFactory: async job => {
          const captured = { ...job }; await refresh(); assertCurrent();
          const gateway = await createMainnetHostedGateway(db, { role: "private", job: captured });
          assertCurrent(); return gateway;
        }, resultSpool,
        privateProvider: policy.provider, getGatewayBalance: async () => {
          await refresh();
          const balance = await getGatewayAvailableAtomic(privatePolicy.signer, ARC_MAINNET_PROFILE);
          await refresh();
          if (balance === null) throw new Error("Private Gateway balance unavailable");
          assertCurrent(); return balance;
        } });
      return Object.freeze({ ...worker, configurationId, reconciliation: createPrivateReconciliation(db, privatePolicy.signer) });
    }
    const key = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
    const account = privateKeyToAccount(key.parse(env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) as `0x${string}`);
    const publicAccount = privateKeyToAccount(key.parse(config.funderKey) as `0x${string}`);
    const policy = privateRuntimePolicy(env, { network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [publicAccount.address], privateTreasurySigner: account.address });
    if (!policy) throw new Error();
    const policyWire = canonicalJson(policy);
    const context = { network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [publicAccount.address], privateTreasurySigner: account.address };
    const assertCurrent = () => {
      assertFrame();
      if (process.env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY !== env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY
        || canonicalJson(privateRuntimePolicy(process.env, context)) !== policyWire)
        throw new Error("Private worker configuration changed");
    };
    assertCurrent();
    const configurationId = privateWorkerConfigurationId(policy);
    const signer = new BatchEvmScheme(account);
    const worker = createPrivateWorker(db, { signerAddress: account.address, signer: {
      createPaymentPayload: async (version, requirements) => {
        const captured = structuredClone(requirements); assertCurrent();
        await assertArcRpcChain(config.rpcUrl);
        assertCurrent(); return signer.createPaymentPayload(version, captured);
      },
    }, resultSpool,
      privateProvider: policy.provider, getGatewayBalance: async () => {
        assertCurrent();
        const balance = await getGatewayAvailableAtomic(account.address);
        assertCurrent();
        if (balance === null)
          throw new Error("Private Gateway balance unavailable");
        return balance;
      } });
    return Object.freeze({ ...worker, configurationId, reconciliation: createPrivateReconciliation(db, account.address) });
  } catch { throw new Error("Private worker configuration unavailable"); }
}
