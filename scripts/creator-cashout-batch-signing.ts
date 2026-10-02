import { existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { CreatorBatchPlan } from "./creator-cashout-batch-plan";
import { validateCreatorBatchPlan } from "./creator-cashout-batch-plan";
import { createWithdrawalRequest, validateWithdrawalRequest } from "../lib/gateway/withdrawal-request";
import { withdrawTypedData } from "../lib/gateway/withdraw-protocol";
import { saveWithdrawalDrillExclusive } from "./withdrawal-drill-files";
import { readCreatorBatchJson } from "./creator-cashout-batch-files";

export async function retainedCreatorBatchOriginal(directory: string, draft: CreatorBatchPlan["drafts"][number]) {
  const original = await validateWithdrawalRequest(await readCreatorBatchJson(join(directory, `original-${draft.id}.json`)));
  assert.equal(original.id, draft.id); assert.deepEqual(original.policy, draft.policy);
  assert.deepEqual(original.request.burnIntent, draft.burnIntent); return original;
}
type Dependencies = { key: (owner: string) => Hex; balance: (owner: string) => Promise<bigint | null>;
  height: (draft: CreatorBatchPlan["drafts"][number]) => Promise<{ minimumBlockHeight: string; maximumBlockHeight: string }> };

/** Same retained-original protocol on Windows and Linux. Wallet signatures never
 * cross transport before their exclusive original has been reread successfully. */
export async function signCreatorBatchOriginals(directory: string, input: unknown, owner: string | undefined,
  dependencies: Dependencies, signal: AbortSignal) {
  const plan = validateCreatorBatchPlan(input), selected = plan.drafts.filter(draft => !owner || draft.owner === owner.toLowerCase());
  assert.ok(selected.length); const results = [];
  for (const draft of selected) {
    try {
      if (existsSync(join(directory, `original-${draft.id}.json`))) {
        await retainedCreatorBatchOriginal(directory, draft); results.push({ owner: draft.owner, requestId: draft.id, state: "original-retained" }); continue;
      }
      const account = privateKeyToAccount(dependencies.key(draft.owner));
      assert.equal(account.address.toLowerCase(), draft.owner);
      const row = plan.manifest.owners.find(row => row.owner === draft.owner)!;
      assert.equal(await dependencies.balance(draft.owner), BigInt(row.availableMicros));
      const height = await dependencies.height(draft);
      assert.ok(BigInt(draft.burnIntent.maxBlockHeight) >= BigInt(height.minimumBlockHeight)
        && BigInt(draft.burnIntent.maxBlockHeight) <= BigInt(height.maximumBlockHeight));
      signal.throwIfAborted();
      saveWithdrawalDrillExclusive(join(directory, `sign-attempt-${draft.id}.json`), { requestId: draft.id });
      const signature = await account.signTypedData(withdrawTypedData(draft.burnIntent));
      const original = await createWithdrawalRequest({ burnIntent: draft.burnIntent, signature }, draft.policy);
      signal.throwIfAborted(); saveWithdrawalDrillExclusive(join(directory, `original-${draft.id}.json`), original);
      assert.deepEqual(await retainedCreatorBatchOriginal(directory, draft), original);
      results.push({ owner: draft.owner, requestId: draft.id, state: "signed-original-retained" });
    } catch { results.push({ owner: draft.owner, requestId: draft.id, state: "unavailable-original-retained" }); }
  }
  return results;
}

/** Select one original env field without evaluating/loading any other variable,
 * endpoint or key role. This cannot silently import a quarantined RPC setting. */
export function creatorBatchPublisherKey(text: string, expectedOwner: string): Hex {
  const lines = text.split(/\r?\n/).filter(line => /^\s*KERYX_PUBLISHER_PRIVATE_KEY\s*=/.test(line));
  if (lines.length !== 1) throw new Error("Exact publisher key field unavailable");
  const match = lines[0].match(/^\s*KERYX_PUBLISHER_PRIVATE_KEY\s*=\s*(['"]?)(0x[a-fA-F0-9]{64})\1\s*(?:#.*)?$/);
  if (!match || privateKeyToAccount(match[2] as Hex).address.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error("Publisher owner mismatch");
  return match[2] as Hex;
}
