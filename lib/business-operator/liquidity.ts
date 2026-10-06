import type { KeryxDB } from "../db/keryx-db";
import { canonicalJson } from "../canonical-json";
import { assertMainnetHostedCustodyReady } from "../payments/mainnet-hosted-gateway";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { assertArcRpcChain } from "../arc-rpc-attestation";
import { config } from "../config";
import type { OperatorLiquidity } from "./contracts";

/** Read-only observation of the original public role. It neither builds a signer
 * nor deposits/rebalances, increases a cap or treats seller revenue as credit. */
export async function observeOperatorLiquidity(db: KeryxDB): Promise<OperatorLiquidity | null> {
  try {
    const policy = await assertMainnetHostedCustodyReady(db);
    const before = await db.hostedTreasuryAccounting(policy.signer);
    await assertArcRpcChain(config.rpcUrl, ARC_MAINNET_PROFILE);
    const available = await getGatewayAvailableAtomic(policy.signer, ARC_MAINNET_PROFILE);
    if (available === null || canonicalJson(before) !== canonicalJson(await db.hostedTreasuryAccounting(policy.signer)) ||
      canonicalJson(policy) !== canonicalJson(await assertMainnetHostedCustodyReady(db))) return null;
    return { availableMicroUsdc: String(available), ...before,
      lifetimeCapMicroUsdc: policy.lifetimeCapMicroUsdc, queryCapMicroUsdc: policy.queryCapMicroUsdc };
  } catch { return null; }
}
