import { resolve } from "node:path";
import type { KeryxDB } from "../db/keryx-db";
import type { privateRuntimePolicy } from "./private-runtime-policy";
import { privateWorkerConfigurationId } from "./private-worker-configuration";
import { readPrivateWorkerStatus } from "./private-worker-status";
import { inspectPrivateTreasuryBacking } from "./private-treasury-backing";

type Policy = NonNullable<ReturnType<typeof privateRuntimePolicy>>;
/** Diagnostic composition only. Never creates a worker, signer or spool, and never
 * uses a matched observation as authority to submit a payment. */
export async function inspectPrivateOperations(db: Pick<KeryxDB, "getPrivateTreasurySummary">,
  policy: Pick<Policy, "merchants" | "treasury" | "serviceFeeMicros" | "disclosure">,
  directory: string, commit: string, signal?: AbortSignal) {
  const configurationId = privateWorkerConfigurationId(policy), treasury = { ...policy.treasury }, root = resolve(directory);
  if (!/^[a-f0-9]{7,40}$/.test(commit)) throw new Error("Private inspection build identity unavailable");
  if (signal?.aborted) return { status: "cancelled" as const, checkoutReady: false as const };
  const before = await readPrivateWorkerStatus(root);
  const backing = await inspectPrivateTreasuryBacking(db, treasury, signal);
  if (signal?.aborted) return { status: "cancelled" as const, checkoutReady: false as const };
  const after = await readPrivateWorkerStatus(root);
  if (signal?.aborted) return { status: "cancelled" as const, checkoutReady: false as const };
  let worker: { status: "unavailable" | "stale" | "changed" | "mismatch" | "matched"; phase?: string };
  if (after.status !== "observed") worker = { status: after.status };
  else if (after.configurationId !== configurationId || after.commit !== commit) worker = { status: "mismatch", phase: after.phase };
  else if (before.status !== "observed" || before.instance !== after.instance || before.phase !== after.phase
    || before.configurationId !== after.configurationId || before.commit !== after.commit) worker = { status: "changed", phase: after.phase };
  else worker = { status: "matched", phase: after.phase };
  return { status: "inspected" as const, worker, treasury: backing,
    checkoutReady: false as const, evidence: "operational-observations-only" as const };
}
