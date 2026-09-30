import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";

/** Owner-installed Arc TESTNET managed-provider policy. Corroboration is not
 * independent verification of validator signatures or Circle account credit. */
export const GATEWAY_FUNDING_RECEIPT_POLICY = Object.freeze({
  format: "gateway-funding-receipt-policy-v1", chainId: "5042002",
  primary: "https://rpc.blockdaemon.testnet.arc.io",
  secondary: "https://rpc.drpc.testnet.arc.io",
  basis: "two-managed-providers-common-finalized-anchor",
  maximumAnchorAgeMs: 60000, maximumFutureSkewMs: 5000,
  requestDeadlineMs: 5000, totalDeadlineMs: 30000, maximumResponseBytes: 4194304,
  maximumBlockTransactions: 50000,
  source: "https://docs.arc.io/arc/references/connect-to-arc",
} as const);
export const GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST = createHash("sha256")
  .update(canonicalJson(GATEWAY_FUNDING_RECEIPT_POLICY)).digest("hex");
export const GATEWAY_FUNDING_RECEIPT_RPC_METHODS = Object.freeze([
  "eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber",
] as const);
export function assertGatewayFundingReceiptPolicy(digest: unknown): void {
  if (digest !== GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST) throw new Error("Funding receipt policy refused");
}
