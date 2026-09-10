import { isAbsolute } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { addressSchema, BUYER_NETWORK } from "../buyer/protocol";
import { privateRuntimePolicy } from "./private-runtime-policy";
import { privateResearchService } from "./private-research-service";
import { inspectPrivateOperations } from "./private-operations-inspection";

/** Prepared owner-pilot bootstrap; no route mounts this yet. Observations limit
 * admission availability, not payment authority. Durable treasury reservation and
 * single-use incoming attempts remain inside the research service. Call through
 * readyPrivatePurchaseService to bound these read-only observations. */
export async function privatePurchaseBootstrap(db: KeryxDB, signal: AbortSignal) {
  const env = { ...process.env };
  if (signal.aborted || env.KERYX_PRIVATE_PURCHASE_ENABLED === undefined || env.KERYX_PRIVATE_PURCHASE_ENABLED === "0") return null;
  try {
    const root = env.KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY, commit = env.KERYX_COMMIT;
    if (env.KERYX_PRIVATE_PURCHASE_ENABLED !== "1" || env.KERYX_PRIVATE_RESEARCH_ENABLED !== "1"
      || config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26
      || env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== config.privateResearchReservedPayees
      || !root || !isAbsolute(root) || !commit || !/^[a-f0-9]{7,40}$/.test(commit)) throw new Error();
    const payers = new Set(z.array(addressSchema).min(1).max(16).parse(
      z.string().max(1024).parse(env.KERYX_PRIVATE_PURCHASE_PAYERS).split(",").map(value => value.trim()),
    ).map(value => value.toLowerCase()));
    const key = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
    const context = { network: config.networkId, publicSeller: config.sellerAddress,
      publicTreasurySigners: [privateKeyToAccount(key.parse(config.funderKey) as `0x${string}`).address],
      privateTreasurySigner: privateKeyToAccount(key.parse(env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) as `0x${string}`).address };
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
      submit(submission: unknown, authenticatedPayer: string) {
        const payer = addressSchema.safeParse(authenticatedPayer);
        if (!payer.success || !payers.has(payer.data.toLowerCase()))
          return Promise.reject(new Error("Private purchase is unavailable for this account"));
        return service.submit(submission, payer.data);
      },
    };
  } catch {
    // Configuration and provider validation errors can contain private values.
    return null;
  }
}
