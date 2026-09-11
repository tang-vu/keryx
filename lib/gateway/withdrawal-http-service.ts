import { accountSessionContext } from "../account-sessions";
import { createWithdrawalRuntimeAdmission } from "./withdrawal-admission-bootstrap";
import { createWithdrawalSubmitHandler } from "./withdrawal-submit-handler";
import { createWithdrawalStatusHandler } from "./withdrawal-status-handler";
import { requestCircleWithdrawalTransfer } from "./withdrawal-transfer-service";
import { createWithdrawalMintReader } from "./withdrawal-mint-reader";
import { withdrawalHttpConfiguration } from "./withdrawal-http-config";
import { withdrawalHeightWindowForRpc } from "./withdrawal-height-window";
import { maxUint256 } from "viem";

export function createConfiguredWithdrawalHttpService(env: Parameters<typeof withdrawalHttpConfiguration>[0],
  chain: Parameters<typeof withdrawalHttpConfiguration>[1]) {
  const options = withdrawalHttpConfiguration(env, chain);
  return options ? createWithdrawalHttpService(options) : null;
}

/** Server configuration only. Concrete cookie/session, database, relay admission and
 * Circle transport binding; never accept these options from a request body. Routes
 * remain unregistered until operator configuration and recovery integration are ready. */
export function createWithdrawalHttpService(options: {
  env: Readonly<Record<string, string | undefined>>; network: string; rpcUrl: string; ceilingWei: string;
  limits: Parameters<typeof createWithdrawalSubmitHandler>[0]["limits"];
  heightLimits: Parameters<typeof withdrawalHeightWindowForRpc>[2];
}) {
  if (options.network !== "eip155:5042002") throw new Error("Withdrawal service network unavailable");
  const admit = createWithdrawalRuntimeAdmission(options.env, options.network, options.rpcUrl, options.ceilingWei);
  const rpcUrl = options.rpcUrl, heightLimits = { ...options.heightLimits };
  return {
    submit: createWithdrawalSubmitHandler({ authenticate: accountSessionContext, limits: options.limits,
      admit, transfer: requestCircleWithdrawalTransfer, validateTerms: async (original, signal) => {
        const height = BigInt(original.request.burnIntent.maxBlockHeight);
        if (height === maxUint256) throw new Error("Finite withdrawal expiry required");
        const window = await withdrawalHeightWindowForRpc(rpcUrl, original.policy, heightLimits, signal);
        signal.throwIfAborted();
        if (height < BigInt(window.minimumBlockHeight) || height > BigInt(window.maximumBlockHeight))
          throw new Error("Withdrawal expiry is outside current limits");
      } }),
    status: createWithdrawalStatusHandler(accountSessionContext, options.env.KERYX_WITHDRAWAL_RELAY_DIRECTORY
      ? createWithdrawalMintReader(options.env.KERYX_WITHDRAWAL_RELAY_DIRECTORY) : undefined),
  };
}
