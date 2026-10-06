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
    const key = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
    const context = mainnet ? { network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [mainnetHostedPolicy(db).signer], privateTreasurySigner: mainnetHostedPolicy(db, "private").signer } : {
      network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [privateKeyToAccount(key.parse(config.funderKey) as `0x${string}`).address],
      privateTreasurySigner: privateKeyToAccount(key.parse(env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) as `0x${string}`).address };
    if(mainnet) await assertMainnetHostedCustodyReady(db,"private");
    const policy = privateRuntimePolicy(env, context);
    if (!policy) throw new Error();
    const report = await inspectPrivateOperations(db, policy, root, commit, signal);
    if (signal.aborted || report.status !== "inspected" || report.worker.status !== "matched"
      || report.worker.phase !== "idle" || report.treasury.status !== "backed"
      || BigInt(report.treasury.unallocatedMicros) === BigInt(0)) return null;
    const service = privateResearchService(db, env, context);
    if (!service) throw new Error();
    return {
      quote: service.quote,
      async submit(submission: unknown, authenticatedPayer: string) {
        if (canaryExecutionPaused()) throw new Error("Finite business canary holds new private admission");
        const payer = addressSchema.safeParse(authenticatedPayer);
        if (!payer.success || payers && !payers.has(payer.data.toLowerCase()))
          return Promise.reject(new Error("Private purchase is unavailable for this account"));
        if(mainnet) {
          const signed=z.object({request:privateRequestSchema}).parse(submission).request;
          await assertMainnetHostedResearchReady(db,String(Math.round(signed.budget*1e6)),"private");
          if(signal.aborted) throw new Error("Private admission cancelled");
        }
        return service.submit(submission, payer.data);
      },
    };
  } catch {
    // Configuration and provider validation errors can contain private values.
    return null;
  }
}
