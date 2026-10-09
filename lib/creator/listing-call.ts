import { REGISTRY_ABI, REVISIONED_REGISTRY_ABI } from "../registry/registry-abi";
import { parseListingSnapshot, type OnchainListingSnapshot } from "./listing-snapshot";

function currentRevision(snapshot: OnchainListingSnapshot): bigint {
  if (snapshot.revision === undefined) throw new Error("Refresh the registry revision before signing.");
  return BigInt(snapshot.revision);
}

/** V1 price edits resubmit the refreshed record; V2/V3 change only price. */
export function listingPriceCall(value: unknown, fetchPriceUsdc6: bigint) {
  const snapshot = parseListingSnapshot(value);
  if (fetchPriceUsdc6 < BigInt(0) || fetchPriceUsdc6 > BigInt("18446744073709551615")) {
    throw new Error("Price is outside the registry's micro-USDC range.");
  }
  if (snapshot.registryVersion !== 1) {
    return { address: snapshot.registryAddress, abi: REVISIONED_REGISTRY_ABI, functionName: "updatePrice" as const,
      args: [snapshot.onchainId, currentRevision(snapshot), fetchPriceUsdc6] as const };
  }
  return { address: snapshot.registryAddress, abi: REGISTRY_ABI, functionName: "update" as const,
    args: [snapshot.onchainId, snapshot.current.payoutWallet, snapshot.current.authors, fetchPriceUsdc6,
      snapshot.current.contentCid, snapshot.current.tags] as const };
}

/** Full-record edits retain the reviewed payout/splits/content and bind its revision. */
export function listingUpdateCall(value: unknown) {
  const snapshot = parseListingSnapshot(value);
  if (snapshot.registryVersion !== 1) {
    return { address: snapshot.registryAddress, abi: REVISIONED_REGISTRY_ABI, functionName: "update" as const,
      args: [snapshot.onchainId, currentRevision(snapshot), snapshot.current.payoutWallet, snapshot.current.authors,
        BigInt(snapshot.current.fetchPriceUsdc6), snapshot.current.contentCid, snapshot.current.tags] as const };
  }
  return { address: snapshot.registryAddress, abi: REGISTRY_ABI, functionName: "update" as const,
    args: [snapshot.onchainId, snapshot.current.payoutWallet, snapshot.current.authors,
      BigInt(snapshot.current.fetchPriceUsdc6), snapshot.current.contentCid, snapshot.current.tags] as const };
}

export function listingDeactivateCall(value: unknown) {
  const snapshot = parseListingSnapshot(value);
  if (snapshot.registryVersion !== 1) {
    return { address: snapshot.registryAddress, abi: REVISIONED_REGISTRY_ABI, functionName: "deactivate" as const,
      args: [snapshot.onchainId, currentRevision(snapshot)] as const };
  }
  return { address: snapshot.registryAddress, abi: REGISTRY_ABI, functionName: "deactivate" as const,
    args: [snapshot.onchainId] as const };
}
