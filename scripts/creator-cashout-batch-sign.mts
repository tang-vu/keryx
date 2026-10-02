/** PC or Linux owner signing only. Never loads arbitrary env or submits transport. */
import assert from "node:assert/strict";
import path from "node:path";
import { parseArgs } from "node:util";
import { creatorBatchOwnerKey, creatorBatchPlanDigest, validateCreatorBatchPlan } from "./creator-cashout-batch-plan.ts";
import { creatorBatchPublisherKey, signCreatorBatchOriginals } from "./creator-cashout-batch-signing.ts";
import { readCreatorBatchJson, readCreatorBatchText, inspectCreatorBatchDirectory } from "./creator-cashout-batch-files.ts";
import { withPrivateWorkerLock } from "../lib/a2a/private-worker-lock.ts";
import { withdrawalHeightWindowForRpc } from "../lib/gateway/withdrawal-height-window.ts";
import { readBoundedJson } from "../lib/read-bounded-json.ts";
import { gatewayAvailableAtomic } from "../lib/gateway/available-balance.ts";

const { values } = parseArgs({ options: { help: { type: "boolean" }, directory: { type: "string" },
  owner: { type: "string" }, keystore: { type: "string" }, "owner-key-env-file": { type: "string" },
  "plan-sha256": { type: "string" }, "max-ahead-blocks": { type: "string" }, "max-processing-lag-blocks": { type: "string" } }, strict: true });
async function main() {
  if (values.help) { console.log("Owner-only original signing: --directory PRIVATE_EXISTING_BATCH --plan-sha256 REVIEWED_DIGEST --owner EXACT_OWNER (--keystore ORIGINAL_FILE | --owner-key-env-file ORIGINAL_PUBLISHER_ENV). Explicit height limits required; official public Arc RPC only. No env loading, signing retry, transfer or broadcast. Windows output needs verified owner/SYSTEM-only DACL."); return; }
  assert.ok(values.directory && path.resolve(values.directory) === values.directory);
  assert.ok(values.owner && values["plan-sha256"] && /^[a-f0-9]{64}$/.test(values["plan-sha256"]));
  assert.ok(values["max-ahead-blocks"] && values["max-processing-lag-blocks"]);
  assert.equal(Number(!!values.keystore) + Number(!!values["owner-key-env-file"]), 1);
  if (process.platform === "linux") process.umask(0o077);
  const directory = await inspectCreatorBatchDirectory(values.directory);
  const plan = validateCreatorBatchPlan(await readCreatorBatchJson(path.join(directory, "plan.json")));
  assert.equal(creatorBatchPlanDigest(plan), values["plan-sha256"]);
  for (const draft of plan.drafts) {
    assert.equal(draft.policy.gatewayWallet, "0x0077777d7eba4688bdef3e311b846f25870a19b9");
    assert.equal(draft.policy.gatewayMinter, "0x0022222abe238cc2c7bb1f21003f0a260052475b");
    assert.equal(draft.policy.asset, "0x3600000000000000000000000000000000000000");
  }
  const key = values.keystore
    ? creatorBatchOwnerKey(await readCreatorBatchJson(path.resolve(values.keystore), 1048576, true), values.owner)
    : creatorBatchPublisherKey(await readCreatorBatchText(path.resolve(values["owner-key-env-file"]!), 65536, true), values.owner);
  const signal = AbortSignal.timeout(60000);
  const results = await withPrivateWorkerLock(directory, () => signCreatorBatchOriginals(directory, plan, values.owner, {
    key: () => key,
    balance: async owner => {
      const response = await fetch("https://gateway-api-testnet.circle.com/v1/balances", { method: "POST", redirect: "error", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "USDC", sources: [{ depositor: owner, domain: 26 }] }), signal });
      return response.ok ? gatewayAvailableAtomic(await readBoundedJson(response, 32768), owner, 26) : null;
    },
    height: draft => withdrawalHeightWindowForRpc("https://rpc.testnet.arc.network", draft.policy,
      { maxAheadBlocks: values["max-ahead-blocks"]!, maxProcessingLagBlocks: values["max-processing-lag-blocks"]! }, signal),
  }, signal));
  console.log(JSON.stringify({ results, circleTransferPosts: 0, broadcasts: 0 }));
  process.exitCode = results.some(row => row.state === "unavailable-original-retained") ? 2 : 0;
}
main().catch(() => { console.error("Original creator signature unavailable; retain reviewed plan and signing markers. Private details omitted."); process.exitCode = 1; });
