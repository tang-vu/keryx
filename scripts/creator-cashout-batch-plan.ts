import { z } from "zod";
import { maxUint256, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createHash } from "node:crypto";
import { canonicalJson } from "../lib/canonical-json";
import { prepareWithdrawIntent } from "../lib/gateway/withdraw-intent";
import { createWithdrawalBrowserDraft } from "../lib/gateway/withdrawal-browser-journal";
import { validateWithdrawIntent, type WithdrawPolicy } from "../lib/gateway/withdraw-protocol";

const micros = z.string().regex(/^[1-9][0-9]{0,7}$/).refine(value => BigInt(value) <= BigInt("55000000"));
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase() as Hex)
  .refine(value => value !== zeroAddress);
export const creatorBatchManifestSchema = z.object({
  format: z.literal("creator-cashout-batch-manifest-v1"), network: z.literal("eip155:5042002"),
  maxTotalDebitMicros: micros, maxFeeMicros: z.literal("3900"),
  owners: z.array(z.object({ owner: address, availableMicros: micros,
    label: z.string().trim().min(1).max(200), sourceName: z.string().trim().min(1).max(200).optional(),
  }).strict()).min(1).max(23),
}).strict().superRefine((value, context) => {
  if (new Set(value.owners.map(row => row.owner)).size !== value.owners.length
    || value.owners.reduce((sum, row) => sum + BigInt(row.availableMicros), BigInt("0")) !== BigInt(value.maxTotalDebitMicros))
    context.addIssue({ code: "custom", message: "Owner uniqueness and exact total debit required" });
});
export type CreatorBatchManifest = z.infer<typeof creatorBatchManifestSchema>;
type Height = { minimumBlockHeight: string; maximumBlockHeight: string };
type WithdrawalBrowserDraft = ReturnType<typeof createWithdrawalBrowserDraft>;
export type CreatorBatchPlan = { format: "creator-cashout-batch-plan-v1"; manifest: CreatorBatchManifest;
  drafts: WithdrawalBrowserDraft[] };
export function creatorBatchPlanDigest(input: unknown) {
  return createHash("sha256").update(canonicalJson(validateCreatorBatchPlan(input))).digest("hex");
}
type Dependencies = { balance: (owner: string) => Promise<bigint | null>;
  height: (policy: WithdrawPolicy) => Promise<Height>;
  estimate: (candidate: ReturnType<typeof prepareWithdrawIntent>, policy: WithdrawPolicy, height: Height) => Promise<ReturnType<typeof prepareWithdrawIntent>> };

/** Bounded unsigned fixed point. Max fee is reserved, not claimed as an actual
 * vendor charge; any post-withdrawal residual must be measured separately. */
export async function prepareCreatorBatchPlan(input: unknown,
  contracts: Pick<WithdrawPolicy, "domain" | "gatewayWallet" | "gatewayMinter" | "asset">,
  dependencies: Dependencies): Promise<CreatorBatchPlan> {
  const manifest = creatorBatchManifestSchema.parse(structuredClone(input));
  const drafts: WithdrawalBrowserDraft[] = [];
  for (const row of manifest.owners) {
    const available = BigInt(row.availableMicros), feeCap = BigInt(manifest.maxFeeMicros);
    if (available <= feeCap || await dependencies.balance(row.owner) !== available)
      throw new Error("Reviewed creator balance unavailable or changed");
    const policy: WithdrawPolicy = { ...contracts, owner: row.owner, recipient: row.owner,
      maxValueMicros: row.availableMicros, maxFeeMicros: manifest.maxFeeMicros };
    const height = await dependencies.height(policy);
    let value = available - feeCap;
    let accepted: ReturnType<typeof prepareWithdrawIntent> | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = prepareWithdrawIntent(row.owner, value, row.owner);
      candidate.maxFee = manifest.maxFeeMicros;
      const estimated = await dependencies.estimate(candidate, policy, height);
      validateWithdrawIntent(estimated, policy);
      if (estimated.spec.value !== value.toString() || estimated.maxBlockHeight === maxUint256.toString()
        || BigInt(estimated.maxBlockHeight) < BigInt(height.minimumBlockHeight)
        || BigInt(estimated.maxBlockHeight) > BigInt(height.maximumBlockHeight)) throw new Error("Batch quote unavailable");
      const next = available - BigInt(estimated.maxFee);
      if (next === value) { accepted = estimated; break; }
      if (next <= BigInt("0")) throw new Error("Batch quote unavailable");
      value = next;
    }
    if (!accepted || await dependencies.balance(row.owner) !== available) throw new Error("Stable batch quote unavailable");
    drafts.push(createWithdrawalBrowserDraft(accepted, policy));
  }
  return validateCreatorBatchPlan({ format: "creator-cashout-batch-plan-v1", manifest, drafts });
}

/** Every command rereads and reconstructs retained draft identities; none can
 * widen the snapshot, replace a recipient or renew a saved signature. */
export function validateCreatorBatchPlan(input: unknown): CreatorBatchPlan {
  const plan = z.object({ format: z.literal("creator-cashout-batch-plan-v1"),
    manifest: creatorBatchManifestSchema, drafts: z.array(z.unknown()).min(1).max(23) }).strict().parse(structuredClone(input));
  if (plan.drafts.length !== plan.manifest.owners.length) throw new Error("Batch draft count unavailable");
  const drafts = plan.drafts.map((value, index) => {
    const supplied = value as WithdrawalBrowserDraft;
    const draft = createWithdrawalBrowserDraft(supplied.burnIntent, supplied.policy);
    const row = plan.manifest.owners[index];
    if (JSON.stringify(draft) !== JSON.stringify(supplied) || draft.owner !== row.owner
      || draft.policy.recipient !== row.owner || draft.policy.domain !== 26
      || draft.policy.maxValueMicros !== row.availableMicros || draft.policy.maxFeeMicros !== plan.manifest.maxFeeMicros
      || BigInt(draft.burnIntent.spec.value) + BigInt(draft.burnIntent.maxFee) !== BigInt(row.availableMicros))
      throw new Error("Batch draft differs from reviewed snapshot");
    return draft;
  });
  if (new Set(drafts.map(row => row.id)).size !== drafts.length) throw new Error("Batch original identity unavailable");
  return { format: plan.format, manifest: plan.manifest, drafts };
}

/** Explicit existing custody file. Labels are advisory; derived address is the
 * authority, and duplicates or conflicts never choose a key silently. */
export function creatorBatchOwnerKey(keystore: unknown, owner: string): Hex {
  const records = z.record(z.object({ address, privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/) }).strict())
    .parse(keystore);
  const matches: Hex[] = [];
  for (const row of Object.values(records)) {
    const key = row.privateKey as Hex;
    const actual = privateKeyToAccount(key).address.toLowerCase();
    if (actual !== row.address) throw new Error("Creator custody address mismatch");
    if (actual === owner.toLowerCase()) matches.push(key);
  }
  if (matches.length !== 1) throw new Error("Exact original creator custody unavailable");
  return matches[0];
}
