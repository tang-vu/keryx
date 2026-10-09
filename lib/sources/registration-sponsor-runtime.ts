import { createPublicClient, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { chainForProfile } from "../chains";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { attestedArcAuthorityHttp } from "../arc-rpc-attestation";
import { getDb } from "../db";
import { REGISTRATION_SPONSOR_ABI, registrationSponsorPolicySchema, type SponsoredRegistration } from "./registration-sponsor-protocol";
import type { RegistrationSponsorChain, RegistrationSponsorContext } from "./registration-sponsor-service";
import { getServerRegistryVersion } from "../registry/registry-version";

/** No key generation, treasury fallback, wallet enrollment or implicit funding. */
export async function registrationSponsorRuntime(): Promise<RegistrationSponsorContext | null> {
  const text = process.env.KERYX_REGISTRATION_SPONSOR_POLICY;
  if (!text) return null;
  try {
    if (text.length > 64_000 || process.env.KERYX_FORCE_OFFLINE === "1" || getServerRegistryVersion() !== 3) throw new Error();
    const policy = registrationSponsorPolicySchema.parse(JSON.parse(text));
    if (policy.network !== config.networkId || policy.deploymentOrigin !== new URL(config.baseUrl).origin ||
      policy.registryAddress !== config.registryAddress?.toLowerCase() || policy.registryAddress !== config.registryReadAddress?.toLowerCase()) throw new Error();
    const key = process.env.KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error();
    const account = privateKeyToAccount(key as Hex);
    if (account.address.toLowerCase() !== policy.sponsorAddress) throw new Error();
    const assertPolicy = () => {
      if (process.env.KERYX_REGISTRATION_SPONSOR_POLICY !== text || process.env.KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY !== key || Date.now() >= policy.expiresAt) throw new Error("Registration sponsor policy unavailable");
    };
    assertPolicy();
    const chain = registrationSponsorReadChain({ chainId: policy.network === "eip155:5042" ? 5042 : 5042002,
      registryAddress: policy.registryAddress, registryCodeHash: policy.registryCodeHash, relayer: policy.sponsorAddress });
    const client = sponsorClient(policy.network === "eip155:5042" ? 5042 : 5042002);
    const db = await getDb();
    if (!db.admitRegistrationSponsor || !db.getRegistrationSponsor || !db.transitionRegistrationSponsor) throw new Error();
    return { db, policy, assertPolicy, chain: { ...chain,
      async sign(transaction) {
        assertPolicy();
        if (transaction.chainId !== chainForProfile(policy.network === "eip155:5042" ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE).id ||
          transaction.to?.toLowerCase() !== policy.registryAddress || transaction.value !== BigInt(0) ||
          transaction.gas !== BigInt(policy.maxGas) || transaction.maxFeePerGas !== BigInt(policy.maxFeePerGasWei) ||
          transaction.maxPriorityFeePerGas !== BigInt(1) || transaction.type !== "eip1559") throw new Error();
        return account.signTransaction(transaction);
      },
      async broadcast(raw) { assertPolicy(); return client.sendRawTransaction({ serializedTransaction: raw }); },
    } };
  } catch { throw new Error("Registration sponsorship configuration is unavailable"); }
}
/** Original receipt recovery needs no private key or active sponsor allowance. */
export function registrationSponsorReadChain(row: Pick<SponsoredRegistration, "chainId" | "registryAddress" | "registryCodeHash" | "relayer">): RegistrationSponsorChain {
  const client = sponsorClient(row.chainId);
  return {
    async assertRegistry() {
      const code = await client.getCode({ address: row.registryAddress });
      if (!code || code === "0x" || keccak256(code) !== row.registryCodeHash ||
        await client.readContract({ address: row.registryAddress, abi: REGISTRATION_SPONSOR_ABI, functionName: "registryVersion" }) !== 3) throw new Error("Reviewed sponsored registry is unavailable");
    },
    async registrationNonce(creator) { return client.readContract({ address: row.registryAddress, abi: REGISTRATION_SPONSOR_ABI, functionName: "registrationNonces", args: [creator] }); },
    async transactionNonce() {
      const pending = await client.getTransactionCount({ address: row.relayer, blockTag: "pending" });
      const latest = await client.getTransactionCount({ address: row.relayer, blockTag: "latest" });
      if (pending !== latest) throw new Error("The dedicated sponsor has another unresolved transaction");
      return pending;
    },
    async estimateGas(data) { return client.estimateGas({ account: row.relayer, to: row.registryAddress, data, value: BigInt(0) }); },
    async sign() { throw new Error("Original receipt reader cannot sign"); },
    async broadcast() { throw new Error("Original receipt reader cannot broadcast"); },
    async receipt(hash) {
      try { return await client.getTransactionReceipt({ hash }); }
      catch (error) { if ((error as { name?: string }).name === "TransactionReceiptNotFoundError") return null; throw new Error("Original registration receipt unavailable"); }
    },
  };
}
function sponsorClient(chainId: 5042 | 5042002) {
  const profile = chainId === 5042 ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE;
  if (profile.networkId !== config.networkId) throw new Error("Original registration belongs to another network");
  return createPublicClient({ chain: chainForProfile(profile), transport: attestedArcAuthorityHttp(config.rpcUrl, { timeout: 4000, retryCount: 0 }, profile) });
}
