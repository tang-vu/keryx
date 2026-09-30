/** One bounded native Arc TEST-USDC transfer. Original signed bytes survive response loss. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createPublicClient, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { withdrawalRpcTransport } from "../lib/gateway/withdrawal-rpc-transport.ts";
import { verifyFundingDrillOriginal } from "./withdrawal-drill-funding-original.ts";
import { withdrawalDrillBuyerKey } from "./withdrawal-drill-buyer-key.ts";
import { saveWithdrawalDrillExclusive as save } from "./withdrawal-drill-files.ts";

const { values } = parseArgs({ options: { prepare: { type: "boolean" }, send: { type: "boolean" },
  recover: { type: "boolean" }, directory: { type: "string" }, recipient: { type: "string" },
  "expected-nonce": { type: "string" }, }, strict: true });
const client = createPublicClient({ transport: withdrawalRpcTransport("https://rpc.testnet.arc.network", AbortSignal.timeout(30000)) });
async function main() {
  assert.equal([values.prepare, values.send, values.recover].filter(Boolean).length, 1);
  assert.ok(values.directory);
  const directory = path.resolve(values.directory), originalFile = path.join(directory, "original.json");
  assert.equal(await client.getChainId(), 5042002);
  if (values.prepare) {
    assert.ok(values.recipient && /^0x[a-fA-F0-9]{40}$/.test(values.recipient));
    assert.ok(values["expected-nonce"] && /^(0|[1-9][0-9]*)$/.test(values["expected-nonce"]));
    const nonce = Number(values["expected-nonce"]); assert.ok(Number.isSafeInteger(nonce));
    const owner = privateKeyToAccount(withdrawalDrillBuyerKey(process.env)), recipient = values.recipient.toLowerCase() as Hex;
    assert.notEqual(owner.address.toLowerCase(), recipient);
    for (const blockTag of ["latest", "pending"] as const) {
      assert.equal(await client.getTransactionCount({ address: owner.address, blockTag }), nonce);
      assert.equal(await client.getTransactionCount({ address: recipient, blockTag }), 0);
      assert.ok([undefined, "0x"].includes(await client.getCode({ address: recipient, blockTag })));
    }
    const block = await client.getBlock({ blockTag: "latest" });
    assert.ok(block.baseFeePerGas !== null && block.baseFeePerGas !== undefined && block.baseFeePerGas <= BigInt(30000000000));
    const transaction = { type: "eip1559" as const, chainId: 5042002, nonce, to: recipient,
      value: BigInt("10000000000000000"), gas: BigInt(21000), maxFeePerGas: BigInt(30000000000),
      maxPriorityFeePerGas: BigInt(5000000000), data: "0x" as Hex };
    assert.ok(await client.getBalance({ address: owner.address, blockTag: "pending" })
      >= transaction.value + transaction.gas * transaction.maxFeePerGas);
    fs.mkdirSync(directory, { mode: 0o700 });
    save(path.join(directory, "signing-attempt.json"), { owner: owner.address, recipient, nonce });
    const raw = await owner.signTransaction(transaction);
    const original = { owner: owner.address.toLowerCase(), recipient, nonce, transactionHash: keccak256(raw), serializedTransaction: raw };
    await verifyFundingDrillOriginal(original);
    save(originalFile, original);
    console.log(JSON.stringify({ state: "funding-original-retained", owner: original.owner, recipient, nonce,
      transactionHash: original.transactionHash, amountWei: transaction.value.toString(),
      maxGasCostWei: (transaction.gas * transaction.maxFeePerGas).toString(), broadcasts: 0 }));
    return;
  }
  const original = await verifyFundingDrillOriginal(JSON.parse(fs.readFileSync(originalFile, "utf8")));
  const { transaction } = original;
  if (values.send) {
    assert.equal(await client.getTransactionCount({ address: original.owner, blockTag: "latest" }), original.nonce);
    assert.equal(await client.getTransactionCount({ address: original.owner, blockTag: "pending" }), original.nonce);
    save(path.join(directory, "broadcast-attempt.json"), { transactionHash: original.transactionHash });
    const returned = await client.sendRawTransaction({ serializedTransaction: original.serializedTransaction });
    assert.equal(returned.toLowerCase(), original.transactionHash);
    console.log(JSON.stringify({ state: "funding-original-submitted", transactionHash: original.transactionHash, broadcasts: 1 }));
    return;
  }
  const receipt = await client.getTransactionReceipt({ hash: original.transactionHash });
  assert.equal(receipt.status, "success"); assert.equal(receipt.from.toLowerCase(), original.owner);
  assert.equal(receipt.to?.toLowerCase(), original.recipient); assert.ok(receipt.gasUsed <= BigInt(21000));
  assert.ok(receipt.effectiveGasPrice <= BigInt(30000000000));
  const included = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(included.hash, receipt.blockHash); assert.ok(included.transactions.includes(original.transactionHash));
  const finalized = await client.getBlock({ blockTag: "finalized" }); assert.ok(finalized.number >= receipt.blockNumber);
  assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
  assert.equal((await client.getTransactionReceipt({ hash: original.transactionHash })).blockHash, receipt.blockHash);
  console.log(JSON.stringify({ state: "funding-original-finalized-observed", transactionHash: original.transactionHash,
    amountWei: transaction.value?.toString(), gasCostWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    blockNumber: receipt.blockNumber.toString(), finalityBasis: "operator-selected-rpc", signatures: 0, broadcasts: 0 }));
}
main().catch(() => { console.error("Funding original unavailable; inspect retained nonce and transaction hash. Never recreate or resend."); process.exitCode = 1; });
