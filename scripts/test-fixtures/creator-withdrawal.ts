import { randomUUID } from "node:crypto";
import { createWalletClient, custom, keccak256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../../lib/config";
import { buildAndSignWithdrawIntent } from "../../lib/gateway/withdraw-intent";
import { createWithdrawalRequest } from "../../lib/gateway/withdrawal-request";

/** Unfunded synthetic owner, attester and relay. Never sends an RPC request. */
export async function creatorWithdrawalFixture() {
  const account = privateKeyToAccount(generatePrivateKey()), attester = privateKeyToAccount(generatePrivateKey());
  const relayer = privateKeyToAccount(generatePrivateKey()).address;
  const client = createWalletClient({ account, transport: custom({ request: async () => { throw new Error("RPC forbidden"); } }) });
  const record = await createWithdrawalRequest(await buildAndSignWithdrawIntent(client, BigInt(50000)), {
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
