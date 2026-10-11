import { config } from "../config";
import { getDb } from "../db";
import { runClaimsEnabled } from "./contracts";
import { preparePrivateRunClaim } from "./delivery";

/** Request-local ordinary domain admission. No public reader/backfill/recovery path. */
export const hostedRunClaimsEnabled = () => runClaimsEnabled(process.env);
export function prepareHostedRunClaim(runId: string, owner?: string) {
  return preparePrivateRunClaim({ enabled: hostedRunClaimsEnabled(), runId, owner,
    binding: { network: config.networkId, origin: config.baseUrl }, db: getDb });
}
