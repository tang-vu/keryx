import { accountSessionContext } from "../account-sessions";
import { createWithdrawalRuntimeAdmission } from "./withdrawal-admission-bootstrap";
import { createWithdrawalSubmitHandler } from "./withdrawal-submit-handler";
import { createWithdrawalStatusHandler } from "./withdrawal-status-handler";
import { requestCircleWithdrawalTransfer } from "./withdrawal-transfer-service";
import { createWithdrawalMintReader } from "./withdrawal-mint-reader";
import { withdrawalHttpConfiguration } from "./withdrawal-http-config";

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
}) {
  if (options.network !== "eip155:5042002") throw new Error("Withdrawal service network unavailable");
  const admit = createWithdrawalRuntimeAdmission(options.env, options.network, options.rpcUrl, options.ceilingWei);
  return {
    submit: createWithdrawalSubmitHandler({ authenticate: accountSessionContext, limits: options.limits,
      admit, transfer: requestCircleWithdrawalTransfer }),
    status: createWithdrawalStatusHandler(accountSessionContext, options.env.KERYX_WITHDRAWAL_RELAY_DIRECTORY
      ? createWithdrawalMintReader(options.env.KERYX_WITHDRAWAL_RELAY_DIRECTORY) : undefined),
  };
}
