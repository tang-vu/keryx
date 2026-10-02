import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../../lib/config';
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from '../../lib/arc-network-profile';
import type { KeryxDB } from '../../lib/db/keryx-db';
import { privateRuntimePolicy } from '../../lib/a2a/private-runtime-policy';
import { assertMainnetHostedCustodyReady } from '../../lib/payments/mainnet-hosted-gateway';

/** Read-only operator composition. The trusted process profile selects custody;
 * neither a request nor a retained legacy key can select the signing domain. */
export async function privateInspectionPolicy(db: KeryxDB, env: Readonly<Record<string, string | undefined>>) {
  if (env.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES !== config.privateResearchReservedPayees)
    throw new Error('Private inspection configuration unavailable');
  let publicSigner: string, privateSigner: string;
  if (config.profile === ARC_MAINNET_PROFILE) {
    // Actual native identity, reviewed policy, public-key match and historical
    // role checks. No signer, signature, reservation or vendor request is created.
    publicSigner = (await assertMainnetHostedCustodyReady(db, 'public')).signer;
    privateSigner = (await assertMainnetHostedCustodyReady(db, 'private')).signer;
  } else if (config.profile === ARC_TESTNET_PROFILE) {
    const key = env.KERYX_PRIVATE_TREASURY_PRIVATE_KEY;
    if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key) || !/^0x[a-fA-F0-9]{64}$/.test(config.funderKey))
      throw new Error('Private inspection configuration unavailable');
    publicSigner = privateKeyToAccount(config.funderKey as `0x${string}`).address;
    privateSigner = privateKeyToAccount(key as `0x${string}`).address;
  } else throw new Error('Private inspection configuration unavailable');
  const policy = privateRuntimePolicy(env, { network: config.networkId, publicSeller: config.sellerAddress,
    publicTreasurySigners: [publicSigner], privateTreasurySigner: privateSigner });
  if (!policy) throw new Error('Private inspection configuration unavailable');
  return policy;
}
