/** Unsigned, read-only vendor quote. Never loads keys or calls /transfer. */
import { parseArgs } from "node:util";
import { prepareWithdrawIntent } from "../lib/gateway/withdraw-intent.ts";
import { config } from "../lib/config.ts";
import { withdrawPolicySchema } from "../lib/gateway/withdraw-protocol.ts";
import { estimateWithdrawalIntent } from "../lib/gateway/withdrawal-estimate.ts";
import { withdrawalHeightWindowForRpc } from "../lib/gateway/withdrawal-height-window.ts";

const { values } = parseArgs({ options: {
  owner: { type: "string" }, "amount-micros": { type: "string" },
  "fee-cap-micros": { type: "string" }, "max-ahead-blocks": { type: "string" },
  "max-processing-lag-blocks": { type: "string" },
}, strict: true });
async function main() {
  if (!values.owner || !values["amount-micros"] || !values["fee-cap-micros"]
    || !values["max-ahead-blocks"] || !values["max-processing-lag-blocks"])
    throw new Error("Explicit owner, amount, fee and height caps required");
  const policy = withdrawPolicySchema.parse({ owner: values.owner, recipient: values.owner,
    domain: config.cctpDomain, gatewayWallet: config.gatewayWallet, gatewayMinter: config.gatewayMinter,
    asset: config.usdcAddress, maxValueMicros: values["amount-micros"], maxFeeMicros: values["fee-cap-micros"] });
  const signal = AbortSignal.timeout(30000);
  const height = await withdrawalHeightWindowForRpc(config.rpcUrl, policy, {
    maxAheadBlocks: values["max-ahead-blocks"],
    maxProcessingLagBlocks: values["max-processing-lag-blocks"],
  }, signal);
  const candidate = prepareWithdrawIntent(policy.owner, BigInt(policy.maxValueMicros), policy.recipient);
  candidate.maxFee = policy.maxFeeMicros;
  const estimate = await estimateWithdrawalIntent(candidate, policy, {
    minimumBlockHeight: height.minimumBlockHeight, maximumBlockHeight: height.maximumBlockHeight,
  }, signal);
  console.log(JSON.stringify({ state: "unsigned-estimate-matched", network: config.networkId,
    owner: policy.owner, recipient: policy.recipient, amountMicros: estimate.spec.value,
    maxFeeMicros: estimate.maxFee, maxBlockHeight: estimate.maxBlockHeight,
    observedBlockNumber: height.observedBlockNumber, signed: false, transferPosts: 0 }));
}
main().catch(() => { console.error("Unsigned withdrawal quote unavailable within selected caps; no authorization signed or transfer submitted."); process.exitCode = 1; });
