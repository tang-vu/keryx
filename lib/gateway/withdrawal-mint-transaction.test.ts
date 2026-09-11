import { expect, it } from "vitest";
import { encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, toHex, type TransactionSerializableEIP1559 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { WITHDRAWAL_MINTER_ABI } from "./withdrawal-mint-observation";
import { matchWithdrawalMintTransaction, type WithdrawalMintTerms } from "./withdrawal-mint-transaction";

async function fixture() {
  const f = await creatorWithdrawalFixture(), relayer = privateKeyToAccount(generatePrivateKey());
  const terms: WithdrawalMintTerms = { relayer: relayer.address, nonce: 7, gas: "300000",
    maxFeePerGas: "2000000000", maxPriorityFeePerGas: "1000000000", gasBudgetWei: "600000000000000" };
  const transaction: TransactionSerializableEIP1559 = { type: "eip1559", chainId: 5042002,
    nonce: terms.nonce, gas: BigInt(terms.gas), maxFeePerGas: BigInt(terms.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(terms.maxPriorityFeePerGas), value: BigInt(0), to: f.record.policy.gatewayMinter,
    data: encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint",
      args: [f.response.attestation, f.response.signature] }) };
  return { ...f, terms, transaction, signer: relayer, raw: await relayer.signTransaction(transaction) };
}

it("binds locally signed bytes, sender, nonce, exact mint calldata and integer native gas bounds", async () => {
  const f = await fixture();
  expect(await matchWithdrawalMintTransaction(f.record, f.response, f.raw, f.terms)).toMatchObject({
    authority: "signed-transaction-matched-only", requestId: f.record.id,
    transactionHash: keccak256(f.raw), serializedTransaction: f.raw, maxGasCostWei: "600000000000000",
    terms: { relayer: f.signer.address.toLowerCase(), nonce: 7 } });
});

it("rejects signed changes to chain, recipient, value, nonce, calldata, access list or gas terms", async () => {
  const f = await fixture();
  for (const changes of [{ chainId: 1 }, { to: f.signer.address }, { value: BigInt(1) }, { nonce: 8 },
    { data: "0x" as const }, { gas: BigInt(300001) }, { maxFeePerGas: BigInt(2000000001) },
    { maxPriorityFeePerGas: BigInt(999999999) }, { accessList: [{ address: f.signer.address, storageKeys: [] }] }]) {
    const raw = await f.signer.signTransaction({ ...f.transaction, ...changes });
    await expect(matchWithdrawalMintTransaction(f.record, f.response, raw, f.terms)).rejects.toThrow("unavailable");
  }
});

it("rejects unsigned bytes, another signer, legacy type and truncated signed payloads", async () => {
  const f = await fixture(), foreign = privateKeyToAccount(generatePrivateKey());
  const legacy = await f.signer.signTransaction({ type: "legacy", chainId: 5042002, nonce: 7,
    gas: f.transaction.gas, gasPrice: BigInt(2000000000), to: f.transaction.to, data: f.transaction.data });
  for (const raw of [serializeTransaction(f.transaction), await foreign.signTransaction(f.transaction), legacy, f.raw.slice(0, -2)])
    await expect(matchWithdrawalMintTransaction(f.record, f.response, raw, f.terms)).rejects.toThrow("unavailable");
});

it("rejects noncanonical or insufficient gas policy and does not confuse micro-USDC with native wei", async () => {
  const f = await fixture();
  for (const changes of [{ gasBudgetWei: "599999999999999" }, { gasBudgetWei: "600" },
    { gas: "0300000" }, { maxFeePerGas: "0" }, { nonce: Number.MAX_SAFE_INTEGER + 1 },
    { maxPriorityFeePerGas: "2000000001" }])
    await expect(matchWithdrawalMintTransaction(f.record, f.response, f.raw, { ...f.terms, ...changes })).rejects.toThrow("unavailable");
});

it("snapshots request, attestation and terms before asynchronous verification", async () => {
  const f = await fixture();
  const pending = matchWithdrawalMintTransaction(f.record, f.response, f.raw, f.terms);
  f.record.request.burnIntent.spec.value = "1"; f.response.attestation = "0x00"; f.terms.nonce = 8;
  expect(await pending).toMatchObject({ transactionHash: keccak256(f.raw), terms: { nonce: 7 } });
});

it("supports zero nonce and zero tip without inventing missing signed fields", async () => {
  const f = await fixture(), terms = { ...f.terms, nonce: 0, maxPriorityFeePerGas: "0" };
  const raw = await f.signer.signTransaction({ ...f.transaction, nonce: 0, maxPriorityFeePerGas: BigInt(0) });
  expect(await matchWithdrawalMintTransaction(f.record, f.response, raw, terms)).toMatchObject({ terms: { nonce: 0 } });
});

it("rejects a high-s signature even when it recovers the authorized relayer", async () => {
  const f = await fixture(), parsed = parseTransaction(f.raw);
  const order = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
  const raw = serializeTransaction({ ...parsed, s: toHex(order - BigInt(parsed.s!), { size: 32 }),
    yParity: parsed.yParity === 0 ? 1 : 0, v: undefined });
  expect((await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase()).toBe(f.signer.address.toLowerCase());
  await expect(matchWithdrawalMintTransaction(f.record, f.response, raw, f.terms)).rejects.toThrow("unavailable");
});
