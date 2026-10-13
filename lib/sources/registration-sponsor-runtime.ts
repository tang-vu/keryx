import { createPublicClient, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { chainForProfile } from "../chains";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { attestedArcAuthorityHttp } from "../arc-rpc-attestation";
import { getDb } from "../db";
import { REGISTRATION_SPONSOR_ABI, registrationPolicyExpired, activeRegistrationSponsorPolicySchema, type ActiveRegistrationSponsorPolicy, type SponsoredRegistration } from "./registration-sponsor-protocol";
import type { RegistrationSponsorChain, RegistrationSponsorContext } from "./registration-sponsor-service";
import { getServerRegistryVersion } from "../registry/registry-version";
import { configuredRegistrationRegistryAuthority } from "../registry/source-registry-authority";

/** No key generation, treasury fallback, wallet enrollment or implicit funding. */
export async function registrationSponsorRuntime(): Promise<RegistrationSponsorContext<ActiveRegistrationSponsorPolicy> | null> {
  const text = process.env.KERYX_REGISTRATION_SPONSOR_POLICY;
  if (!text) return null;
  try {
    if (text.length > 64_000 || process.env.KERYX_FORCE_OFFLINE === "1" || getServerRegistryVersion() !== 3) throw new Error();
    const policy = activeRegistrationSponsorPolicySchema.parse(JSON.parse(text));
    if (policy.network !== config.networkId || policy.deploymentOrigin !== new URL(config.baseUrl).origin ||
      policy.registryAddress !== config.registryAddress?.toLowerCase() || policy.registryAddress !== config.registryReadAddress?.toLowerCase()) throw new Error();
    const origin = configuredRegistrationRegistryAuthority();
    if (origin && (origin.network !== policy.network || origin.address !== policy.registryAddress ||
      origin.version !== 3 || origin.codeHash !== policy.registryCodeHash)) throw new Error();
    const key = process.env.KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error();
    const account = privateKeyToAccount(key as Hex);
    if (account.address.toLowerCase() !== policy.sponsorAddress) throw new Error();
    const assertPolicy = () => {
      if (process.env.KERYX_REGISTRATION_SPONSOR_POLICY !== text || process.env.KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY !== key || registrationPolicyExpired(policy, Date.now())) throw new Error("Registration sponsor policy unavailable");
    };
    assertPolicy();
    const chain = registrationSponsorReadChain({ chainId: policy.network === "eip155:5042" ? 5042 : 5042002,
      registryAddress: policy.registryAddress, registryCodeHash: policy.registryCodeHash, relayer: policy.sponsorAddress });
    const client = sponsorClient(policy.network === "eip155:5042" ? 5042 : 5042002);
    const db = await getDb();
    if (!db.admitRegistrationSponsor || !db.getRegistrationSponsor || !db.transitionRegistrationSponsor || !db.getRegistrationSponsorExecution) throw new Error();
    if (policy.protocol === "keryx-registration-sponsor-v2" && !db.inspectRegistrationSponsorFunding) throw new Error();
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
    async fundingObservation() {
      const block = await client.getBlock({ blockTag: "latest" }), now = Date.now();
      if (!block.hash || block.number === null || block.timestamp > BigInt(Math.floor(now / 1000) + 5) ||
          block.timestamp < BigInt(Math.floor(now / 1000) - 60)) throw new Error("Fresh sponsor funds are unavailable");
      const [nativeBalanceWei, latestTransactionNonce] = await Promise.all([
        client.getBalance({ address: row.relayer, blockNumber: block.number }),
        client.getTransactionCount({ address: row.relayer, blockNumber: block.number }),
      ]);
      const confirmed = await client.getBlock({ blockNumber: block.number }), observedAt = Date.now();
      if (confirmed.hash !== block.hash || confirmed.number !== block.number || confirmed.timestamp !== block.timestamp ||
          block.timestamp > BigInt(Math.floor(observedAt / 1000) + 5) || block.timestamp < BigInt(Math.floor(observedAt / 1000) - 60))
        throw new Error("Consistent sponsor funds are unavailable");
      return { network: row.chainId === 5042 ? "eip155:5042" as const : "eip155:5042002" as const,
        sponsorAddress: row.relayer, blockNumber: block.number.toString(), blockHash: block.hash,
        blockTimestamp: Number(block.timestamp), observedAt, nativeBalanceWei: nativeBalanceWei.toString(), latestTransactionNonce };
    },
    async hasExpiredDeadline(deadline) {
      const block = await client.getBlock({ blockTag: "latest" });
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (!Number.isSafeInteger(deadline) || !block.hash || block.number === null || block.timestamp > now + BigInt(5) || block.timestamp < now - BigInt(60))
        throw new Error("Fresh original expiry observation is unavailable");
      return block.timestamp > BigInt(deadline);
    },
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
