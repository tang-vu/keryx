import { randomUUID } from "node:crypto";
import { createWalletClient, custom, encodeFunctionData, keccak256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../../lib/config";
import { buildAndSignWithdrawIntent } from "../../lib/gateway/withdraw-intent";
import { createWithdrawalRequest } from "../../lib/gateway/withdrawal-request";
import { withdrawTypedData } from "../../lib/gateway/withdraw-protocol";
import { WITHDRAWAL_MINTER_ABI } from "../../lib/gateway/withdrawal-mint-observation";

/** Unfunded synthetic owner, attester and relay. Never sends an RPC request. */
export async function creatorWithdrawalFixture(options: { maxBlockHeight?: string } = {}) {
  const account = privateKeyToAccount(generatePrivateKey()), attester = privateKeyToAccount(generatePrivateKey());
  const relayer = privateKeyToAccount(generatePrivateKey()).address;
  const client = createWalletClient({ account, transport: custom({ request: async () => { throw new Error("RPC forbidden"); } }) });
  const signed = await buildAndSignWithdrawIntent(client, BigInt(50000));
  if (options.maxBlockHeight !== undefined) {
    signed.burnIntent.maxBlockHeight = options.maxBlockHeight;
    signed.signature = await account.signTypedData(withdrawTypedData(signed.burnIntent as Parameters<typeof withdrawTypedData>[0]));
  }
  const record = await createWithdrawalRequest(signed, {
    owner: account.address, recipient: account.address, domain: config.cctpDomain,
    gatewayWallet: config.gatewayWallet, gatewayMinter: config.gatewayMinter, asset: config.usdcAddress,
    maxValueMicros: "50000", maxFeeMicros: BigInt(Math.round(config.withdrawMaxFeeUsdc * 1e6)).toString(),
  });
  const s = record.request.burnIntent.spec;
  const spec = "ca85def7000000010000001a0000001a" +
    [s.sourceContract,s.destinationContract,s.sourceToken,s.destinationToken,s.sourceDepositor,
      s.destinationRecipient,s.sourceSigner,s.destinationCaller].map(value => value.slice(2)).join("") +
    BigInt(s.value).toString(16).padStart(64,"0") + s.salt.slice(2) + "00000000";
  const attestation = `0xff6fb334${BigInt(10000).toString(16).padStart(64,"0")}00000154${spec}` as Hex;
  const response = { transferId: randomUUID(), attestation,
    signature: await attester.signMessage({ message: { raw: keccak256(attestation) } }), expirationBlock: "10000" };
  return { record, response, relayer, attester: attester.address };
}

/** Signed local test transaction only; the relayer is unfunded and no RPC is used. */
export async function creatorMintFixture() {
  const f = await creatorWithdrawalFixture(), signer = privateKeyToAccount(generatePrivateKey());
  const terms = { relayer: signer.address, nonce: 0, gas: "300000", maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000000", gasBudgetWei: "600000000000000" };
  const raw = await signer.signTransaction({ type: "eip1559", chainId: 5042002, nonce: 0,
    gas: BigInt(terms.gas), maxFeePerGas: BigInt(terms.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(terms.maxPriorityFeePerGas), value: BigInt(0), to: f.record.policy.gatewayMinter,
    data: encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint",
      args: [f.response.attestation, f.response.signature] }) });
  return { ...f, terms, raw };
}
