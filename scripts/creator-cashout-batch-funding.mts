/** Explicit, bounded Arc-testnet relay funding; never loads environment settings. */
import assert from "node:assert/strict";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { withdrawalRpcTransport } from "../lib/gateway/withdrawal-rpc-transport.ts";
import { readCreatorBatchText } from "./creator-cashout-batch-files.ts";
import { CREATOR_CASHOUT_FUNDER, creatorCashoutFunderKey } from "./creator-cashout-batch-funding-original.ts";
import { prepareCreatorCashoutFunding, sendCreatorCashoutFunding, recoverCreatorCashoutFunding } from "./creator-cashout-batch-funding-execution.ts";

const { values } = parseArgs({ options: { prepare: { type: "boolean" }, send: { type: "boolean" }, recover: { type: "boolean" },
  help: { type: "boolean" }, directory: { type: "string" }, recipient: { type: "string" },
  "expected-nonce": { type: "string" }, "key-env-file": { type: "string" }, rpc: { type: "string" },
  "fresh-relay-custody-verified": { type: "boolean" } }, strict: true });
async function main() {
  if (values.help) {
    console.log("Usage: node --import tsx scripts/creator-cashout-batch-funding.mts --prepare|--send|--recover --directory ABSOLUTE_PRIVATE_PATH --rpc https://rpc.testnet.arc.network\nPrepare requires --recipient FRESH_RELAY --expected-nonce N --key-env-file /root/keryx/.env.local --fresh-relay-custody-verified. Exactly .21 native Arc-testnet USDC; funding gas capped at .00063. Send and recover are keyless. Any uncertainty preserves the original and forbids another signature or broadcast.");
    return;
  }
  assert.equal(process.platform, "linux");
  assert.equal([values.prepare, values.send, values.recover].filter(Boolean).length, 1);
  assert.ok(values.directory && isAbsolute(values.directory) && resolve(values.directory) === values.directory);
  assert.equal(values.rpc, "https://rpc.testnet.arc.network");
  const signal = AbortSignal.timeout(30000);
  const rpc = createPublicClient({ transport: withdrawalRpcTransport(values.rpc, signal) });
  let result;
  if (values.prepare) {
    assert.equal(values["key-env-file"], "/root/keryx/.env.local");
    assert.ok(values["fresh-relay-custody-verified"] && values.recipient);
    assert.ok(values["expected-nonce"] && /^(0|[1-9][0-9]*)$/.test(values["expected-nonce"]));
    const nonce = Number(values["expected-nonce"]); assert.ok(Number.isSafeInteger(nonce));
    const key = creatorCashoutFunderKey(await readCreatorBatchText(values["key-env-file"], 131072, true));
    const signer = privateKeyToAccount(key); assert.equal(signer.address.toLowerCase(), CREATOR_CASHOUT_FUNDER);
    result = await prepareCreatorCashoutFunding(values.directory,
      { owner: CREATOR_CASHOUT_FUNDER, recipient: values.recipient.toLowerCase(), nonce }, signer, rpc, signal);
  } else {
    assert.ok(!values["key-env-file"] && !values["expected-nonce"] && !values.recipient && !values["fresh-relay-custody-verified"]);
    result = values.send ? await sendCreatorCashoutFunding(values.directory, rpc, signal)
      : await recoverCreatorCashoutFunding(values.directory, rpc, signal);
  }
  console.log(JSON.stringify(result));
}
main().catch(() => { console.error("Creator cash-out funding original unavailable. Retain its directory and markers; inspect the original nonce/hash through keyless recovery. Never recreate, resign or rebroadcast after uncertainty."); process.exitCode = 1; });
