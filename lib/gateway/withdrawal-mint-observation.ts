import { z } from "zod";
import { createPublicClient, encodeFunctionData, keccak256, recoverMessageAddress, zeroAddress, type PublicClient, type Hex } from "viem";
import { withdrawalRpcTransport } from "./withdrawal-rpc-transport";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";

// Pinned Circle Mints.sol: EIP-191 signature over keccak256(payload), then signer allowlist.
// fd51093c7a1ba8e50ea2c6029ebf1bdc2bb2b8e8/src/modules/minter/Mints.sol
export const WITHDRAWAL_MINTER_ABI = [
  { type: "function", name: "isAttestationSigner", stateMutability: "view",
    inputs: [{ name: "signer", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "gatewayMint", stateMutability: "nonpayable",
    inputs: [{ name: "attestationPayload", type: "bytes" }, { name: "signature", type: "bytes" }], outputs: [] },
] as const;
type MintReadClient = Pick<PublicClient, "getChainId" | "getBlock" | "getCode" | "readContract" | "call">;
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase() as Hex)
  .refine(value => value !== zeroAddress);
const hash = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase() as Hex);
const blockSchema = z.object({ number: z.bigint().nonnegative(), hash, timestamp: z.bigint().nonnegative() });
const DEADLINE_MS = 5000, MAX_BLOCK_AGE_MS = 60000;

/** Server-owned, read-only dependency. HTTP timeout/abort belongs in the transport too;
 * the outer deadline prevents late completion from returning an eligible observation. */
export function createWithdrawalMintObserver(makeClient: (signal: AbortSignal) => MintReadClient, nowMs = Date.now) {
  return async function observe(value: WithdrawalRequestRecord, response: unknown, selectedRelayer: string, signal: AbortSignal) {
    if (signal.aborted) return null;
    let recordCopy: unknown, responseCopy: unknown, relayer: Hex;
    try { recordCopy = structuredClone(value); responseCopy = structuredClone(response); relayer = address.parse(selectedRelayer); }
    catch { return null; }
    const stop = new AbortController();
    let cancel!: () => void;
    const cancelled = new Promise<null>(resolve => { cancel = () => { stop.abort(); resolve(null); }; });
    const timer = setTimeout(cancel, DEADLINE_MS);
    signal.addEventListener("abort", cancel, { once: true });
    const live = () => { if (stop.signal.aborted || signal.aborted) throw new Error(); };
    const fresh = (timestamp: bigint) => {
      const current = nowMs();
      if (!Number.isSafeInteger(current) || current < 0) throw new Error();
      const age = BigInt(current) - timestamp * BigInt(1000);
      if (age > BigInt(MAX_BLOCK_AGE_MS) || age < BigInt(-5000)) throw new Error();
      return new Date(current).toISOString();
    };
    const inspect = async () => {
      live();
      const record = await validateWithdrawalRequest(recordCopy); live();
      const matched = await matchWithdrawalAttestation(record, responseCopy); live();
      const attester = await recoverMessageAddress({ message: { raw: keccak256(matched.attestation) }, signature: matched.signature }); live();
      const client = makeClient(stop.signal);
      if (await client.getChainId() !== 5042002) throw new Error(); live();
      const block = blockSchema.parse(await client.getBlock({ blockTag: "latest" })); live(); fresh(block.timestamp);
      if (block.number > BigInt(matched.expirationBlock)) throw new Error();
      const minter = record.policy.gatewayMinter;
      const code = await client.getCode({ address: minter, blockNumber: block.number }); live();
      if (!code || !/^0x(?:[a-fA-F0-9]{2})+$/.test(code)) throw new Error();
      if (await client.readContract({ address: minter, abi: WITHDRAWAL_MINTER_ABI,
        functionName: "isAttestationSigner", args: [attester], blockNumber: block.number }) !== true) throw new Error(); live();
      const data = encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint",
        args: [matched.attestation, matched.signature] });
      const simulation = await client.call({ account: relayer, to: minter, data, value: BigInt(0), blockNumber: block.number }); live();
      if (simulation.data !== undefined && simulation.data !== "0x") throw new Error();
      const rechecked = blockSchema.parse(await client.getBlock({ blockNumber: block.number })); live();
      if (rechecked.number !== block.number || rechecked.hash !== block.hash || rechecked.timestamp !== block.timestamp
        || await client.getChainId() !== 5042002) throw new Error(); live();
      return { status: "eligible-at-observed-block" as const, authority: "read-only-observation" as const,
        requestId: record.id, transferSpecHash: matched.transferSpecHash, chainId: 5042002 as const,
        relayer, minter, attester: attester.toLowerCase() as Hex, blockNumber: block.number.toString(),
        blockHash: block.hash, minterCodeHash: keccak256(code), observedAt: fresh(block.timestamp),
        chainFinalityVerified: false as const };
    };
    try {
      if (signal.aborted) { cancel(); return null; }
      return await Promise.race([inspect().catch(() => null), cancelled]);
    } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); stop.abort(); }
  };
}

/** Operator-selected RPC only. No wallet client, signing key or write RPC exists here. */
export function withdrawalMintObserverForRpc(rpcUrl: string) {
  try {
    const url = new URL(rpcUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    const endpoint = url.toString();
    return createWithdrawalMintObserver(signal => createPublicClient({ transport: withdrawalRpcTransport(endpoint, signal) }));
  } catch { throw new Error("Withdrawal RPC unavailable"); }
}
