import { canonicalJson } from "../canonical-json";
import { applicationStorageIdentity, assertApplicationStorageCurrentLocal } from "../db/application-storage";
import { configuredHostedTreasuryPolicy } from "../payments/hosted-treasury-policy";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { mainnetHostedPolicy } from "../payments/mainnet-hosted-gateway";
import { privateRuntimePolicy } from "./private-runtime-policy";
import { privateResearchService } from "./private-research-service";

/** Quote-only bootstrap. No legacy wallet creation/loading, signature, deposit or payment.
 * Enabling config does not enable private purchase; the HTTP response remains a preview. */
export async function privateQuoteBootstrap(db: KeryxDB) {
  const env = { ...process.env };
  if (env.KERYX_PRIVATE_RESEARCH_ENABLED === undefined || env.KERYX_PRIVATE_RESEARCH_ENABLED === "0") return null;
  try {
    const mainnet = config.networkId === ARC_MAINNET_PROFILE.networkId;
    const frame = () => canonicalJson({ profile: config.profile, network: config.networkId,
      cctpDomain: config.cctpDomain, seller: config.sellerAddress, reservedPayees: config.privateResearchReservedPayees,
      baseUrl: config.baseUrl, rpcUrl: config.rpcUrl, maxTimeoutSeconds: config.maxTimeoutSeconds,
      timeoutEnv: process.env.KERYX_MAX_TIMEOUT_SECONDS, forceOffline: process.env.KERYX_FORCE_OFFLINE });
    const capturedFrame = frame();
    const assertFrame = () => {
      if (frame() !== capturedFrame || process.env.KERYX_PRIVATE_RESEARCH_ENABLED !== env.KERYX_PRIVATE_RESEARCH_ENABLED
        || process.env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES)
        throw new Error("Private quote configuration changed");
    };
    const key = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
    const identity = mainnet ? await applicationStorageIdentity(db, "write") : null;
    assertFrame();
    const publicPolicy = mainnet ? await mainnetHostedPolicy(db) : null;
    assertFrame();
    const privatePolicy = mainnet ? await mainnetHostedPolicy(db, "private") : null;
    assertFrame();
    const context = publicPolicy && privatePolicy ? { network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [publicPolicy.signer], privateTreasurySigner: privatePolicy.signer } : {
      network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [privateKeyToAccount(key.parse(config.funderKey) as `0x${string}`).address],
      privateTreasurySigner: privateKeyToAccount(key.parse(env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) as `0x${string}`).address };
    const policy = privateRuntimePolicy(env, context), policyWire = canonicalJson(policy);
    const assertCurrent = () => {
      assertFrame();
      if (env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== config.privateResearchReservedPayees
        || canonicalJson(privateRuntimePolicy(process.env, context)) !== policyWire)
        throw new Error("Private quote configuration changed");
      if (identity && publicPolicy && privatePolicy) {
        assertApplicationStorageCurrentLocal(db, "write");
        if (config.profile !== ARC_MAINNET_PROFILE
          || canonicalJson(configuredHostedTreasuryPolicy(identity, publicPolicy.origin)) !== canonicalJson(publicPolicy)
          || canonicalJson(configuredHostedTreasuryPolicy(identity, privatePolicy.origin, "private")) !== canonicalJson(privatePolicy))
          throw new Error("Private quote authority changed");
      } else if (config.funderKey !== publicKey || process.env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY !== env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY)
        throw new Error("Private quote custody changed");
    };
    const publicKey = mainnet ? undefined : config.funderKey;
    assertCurrent();
    const service = privateResearchService(db, env, context);
    return service ? { quote(input: unknown) { assertCurrent(); return service.quote(input); } } : null;
  } catch { throw new Error("Private quote configuration unavailable"); }
}
