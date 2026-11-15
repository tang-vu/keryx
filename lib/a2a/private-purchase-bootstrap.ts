import { canonicalJson } from "../canonical-json";
import { applicationStorageIdentity, assertApplicationStorageCurrentLocal } from "../db/application-storage";
import { configuredHostedTreasuryPolicy } from "../payments/hosted-treasury-policy";
import { isAbsolute } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { addressSchema, BUYER_NETWORK } from "../buyer/protocol";
import { privateRequestSchema } from "../buyer/private-request-commitment";
import { privateRuntimePolicy } from "./private-runtime-policy";
import { privateResearchService } from "./private-research-service";
import { inspectPrivateOperations } from "./private-operations-inspection";
import { mainnetHostedPolicy, assertMainnetHostedResearchReady, assertMainnetHostedCustodyReady } from "../payments/mainnet-hosted-gateway";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { canaryExecutionPaused } from "../business-operator/canary-policy";

/** Operator-configured private purchase bootstrap, disabled by default. Observations limit
 * admission availability, not payment authority. Durable treasury reservation and
 * single-use incoming attempts remain inside the research service. Call through
 * readyPrivatePurchaseService to bound these read-only observations. */
export async function privatePurchaseBootstrap(db: KeryxDB, signal: AbortSignal, authenticatedPayer?: string) {
  if (canaryExecutionPaused()) return null;
  const env = { ...process.env };
  if (signal.aborted || env.KERYX_PRIVATE_PURCHASE_ENABLED === undefined || env.KERYX_PRIVATE_PURCHASE_ENABLED === "0") return null;
  try {
    const root = env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY, commit = env.KERYX_COMMIT;
    if (env.KERYX_PRIVATE_PURCHASE_ENABLED !== "1" || env.KERYX_PRIVATE_RESEARCH_ENABLED !== "1"
      || config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26
      || env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== config.privateResearchReservedPayees
      || !root || !isAbsolute(root) || !commit || !/^[a-f0-9]{7,40}$/.test(commit)) throw new Error();
    const mainnet = config.networkId === ARC_MAINNET_PROFILE.networkId;
    const payers = mainnet ? null : new Set(z.array(addressSchema).min(1).max(16).parse(
      z.string().max(1024).parse(env.KERYX_PRIVATE_PURCHASE_PAYERS).split(",").map(value => value.trim()),
    ).map(value => value.toLowerCase()));
    if (authenticatedPayer !== undefined) {
      const payer = addressSchema.safeParse(authenticatedPayer);
      if (!payer.success || payers && !payers.has(payer.data.toLowerCase())) return null;
    }
    const frame = () => canonicalJson({ profile: config.profile, network: config.networkId,
      cctpDomain: config.cctpDomain, seller: config.sellerAddress, reservedPayees: config.privateResearchReservedPayees,
      baseUrl: config.baseUrl, rpcUrl: config.rpcUrl, maxTimeoutSeconds: config.maxTimeoutSeconds,
      timeoutEnv: process.env.KERYX_MAX_TIMEOUT_SECONDS, forceOffline: process.env.KERYX_FORCE_OFFLINE, publicKey: mainnet ? undefined : config.funderKey });
    const capturedFrame = frame();
    const assertFrame = () => {
      if (signal.aborted || canaryExecutionPaused() || frame() !== capturedFrame
        || process.env.KERYX_PRIVATE_PURCHASE_ENABLED !== env.KERYX_PRIVATE_PURCHASE_ENABLED
        || process.env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES
        || process.env.KERYX_PRIVATE_PURCHASE_PAYERS !== env.KERYX_PRIVATE_PURCHASE_PAYERS
        || process.env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY !== root || process.env.KERYX_COMMIT !== commit)
        throw new Error("Private admission configuration changed");
    };
    const identity = mainnet ? await applicationStorageIdentity(db, "write") : null;
    assertFrame();
    const publicPolicy = mainnet ? await mainnetHostedPolicy(db) : null;
    assertFrame();
    const privatePolicy = mainnet ? await mainnetHostedPolicy(db, "private") : null;
    assertFrame();
    const key = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
    const context = publicPolicy && privatePolicy ? { network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [publicPolicy.signer], privateTreasurySigner: privatePolicy.signer } : {
      network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [privateKeyToAccount(key.parse(config.funderKey) as `0x${string}`).address],
      privateTreasurySigner: privateKeyToAccount(key.parse(env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) as `0x${string}`).address };
    const policy = privateRuntimePolicy(env, context);
    if (!policy) throw new Error();
    const policyWire = canonicalJson(policy);
    const assertCurrent = () => {
      assertFrame();
      if (canonicalJson(privateRuntimePolicy(process.env, context)) !== policyWire
        || process.env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY !== env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY
        || mainnet && process.env.KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY !== env.KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY)
        throw new Error("Private admission configuration changed");
      if (identity && publicPolicy && privatePolicy) {
        assertApplicationStorageCurrentLocal(db, "write");
        if (config.profile !== ARC_MAINNET_PROFILE
          || canonicalJson(configuredHostedTreasuryPolicy(identity, publicPolicy.origin)) !== canonicalJson(publicPolicy)
          || canonicalJson(configuredHostedTreasuryPolicy(identity, privatePolicy.origin, "private")) !== canonicalJson(privatePolicy))
          throw new Error("Private admission authority changed");
      }
    };
    const refresh = async () => {
      if (identity) {
        const current = await applicationStorageIdentity(db, "write");
        if (canonicalJson(current) !== canonicalJson(identity)) throw new Error("Private admission storage changed");
      }
      assertCurrent();
    };
    if (mainnet) await assertMainnetHostedCustodyReady(db, "private");
    if (mainnet) await refresh(); else assertCurrent();
    const report = await inspectPrivateOperations(db, policy, root, commit, signal);
    if (mainnet) await refresh(); else assertCurrent();
    if (signal.aborted || report.status !== "inspected" || report.worker.status !== "matched"
      || report.worker.phase !== "idle" || report.treasury.status !== "backed"
      || BigInt(report.treasury.unallocatedMicros) === BigInt(0)) return null;
    const service = privateResearchService(db, env, context);
    if (!service) throw new Error();
    return {
      quote(input: unknown) { assertCurrent(); return service.quote(input); },
      async submit(submission: unknown, authenticatedPayer: string) {
        if (canaryExecutionPaused()) throw new Error("Finite business canary holds new private admission");
        const payer = addressSchema.safeParse(authenticatedPayer);
        if (!payer.success || payers && !payers.has(payer.data.toLowerCase()))
          return Promise.reject(new Error("Private purchase is unavailable for this account"));
        const captured = structuredClone(submission);
        assertCurrent();
        if(mainnet) {
          const signed=z.object({request:privateRequestSchema}).parse(captured).request;
          await assertMainnetHostedResearchReady(db,String(Math.round(signed.budget*1e6)),"private");
          assertCurrent();
        }
        assertCurrent();
        return service.submit(captured, payer.data);
      },
    };
  } catch {
    // Configuration and provider validation errors can contain private values.
    return null;
  }
}
