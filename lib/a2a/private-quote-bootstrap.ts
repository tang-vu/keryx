import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { mainnetHostedPolicy } from "../payments/mainnet-hosted-gateway";
import { privateResearchService } from "./private-research-service";

/** Quote-only bootstrap. No legacy wallet creation/loading, signature, deposit or payment.
 * Enabling config does not enable private purchase; the HTTP response remains a preview. */
export function privateQuoteBootstrap(db: KeryxDB) {
  const env = process.env;
  if (env.KERYX_PRIVATE_RESEARCH_ENABLED === undefined || env.KERYX_PRIVATE_RESEARCH_ENABLED === "0") return null;
  try {
    const key = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
    const context = config.networkId === ARC_MAINNET_PROFILE.networkId ? { network:config.networkId,publicSeller:config.sellerAddress,
      publicTreasurySigners:[mainnetHostedPolicy(db).signer],privateTreasurySigner:mainnetHostedPolicy(db,"private").signer } : {
      network:config.networkId,publicSeller:config.sellerAddress,
      publicTreasurySigners:[privateKeyToAccount(key.parse(config.funderKey) as `0x${string}`).address],
      privateTreasurySigner:privateKeyToAccount(key.parse(env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY) as `0x${string}`).address };
    if (env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== config.privateResearchReservedPayees) throw new Error();
    const service = privateResearchService(db,env,context);
    return service ? { quote: service.quote } : null;
  } catch { throw new Error("Private quote configuration unavailable"); }
}
