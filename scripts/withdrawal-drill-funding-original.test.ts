import { expect, it } from "vitest";
import { keccak256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyFundingDrillOriginal } from "./withdrawal-drill-funding-original";

async function fixture(change: Record<string, unknown> = {}) {
  const owner = privateKeyToAccount(generatePrivateKey()), recipient = `0x${"ab".repeat(20)}` as Hex;
  const transaction = { type: "eip1559" as const, chainId: 5042002, nonce: 15, to: recipient,
    value: BigInt("10000000000000000"), gas: BigInt(21000), maxFeePerGas: BigInt(30000000000),
    maxPriorityFeePerGas: BigInt(5000000000), data: "0x" as Hex, ...change };
  const serializedTransaction = await owner.signTransaction(transaction);
  return { owner: owner.address.toLowerCase(), recipient, nonce: 15,
    serializedTransaction, transactionHash: keccak256(serializedTransaction) };
}
it("retains the exact original signed funding identity without any signing or RPC during recovery", async () => {
  const original = await fixture(), recovered = await verifyFundingDrillOriginal(original);
  expect(recovered.transactionHash).toBe(original.transactionHash);
  expect(recovered.serializedTransaction).toBe(original.serializedTransaction);
  expect(recovered.transaction.value).toBe(BigInt("10000000000000000"));
});
it("rejects valid signatures with another chain, amount, recipient, gas, fee, nonce or calldata", async () => {
  for (const changed of [{ chainId: 1 }, { value: BigInt("10000000000000001") }, { gas: BigInt(21001) },
    { maxFeePerGas: BigInt(30000000001) }, { maxPriorityFeePerGas: BigInt(5000000001) },
    { nonce: 16 }, { data: "0x12" }, { to: `0x${"cd".repeat(20)}` },
    { accessList: [{ address: `0x${"cd".repeat(20)}`, storageKeys: [] }] }])
    await expect(verifyFundingDrillOriginal(await fixture(changed))).rejects.toThrow();
});
it("rejects changed original metadata, foreign signer and hidden fields", async () => {
  const original = await fixture();
  for (const changed of [{ transactionHash: `0x${"00".repeat(32)}` }, { nonce: 16 },
    { recipient: `0x${"cd".repeat(20)}` }, { owner: `0x${"ef".repeat(20)}` }, { secret: "forbidden" }])
    await expect(verifyFundingDrillOriginal({ ...original, ...changed })).rejects.toThrow();
});
