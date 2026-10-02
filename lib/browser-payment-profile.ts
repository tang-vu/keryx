import { ARC_MAINNET_PROFILE, configuredRegistryAddress, paymentRuntimeProfile } from "./arc-network-profile";
/** Exact public reference is replaced by Next in the page AND worker bundle. Capture once;
 * never import server config or trust a request-selected profile when authorizing signatures.
 */
const pinned = paymentRuntimeProfile(process.env.NEXT_PUBLIC_KERYX_NETWORK);
const registry = process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS;
export function browserPaymentProfile() { return pinned; }
export function browserRegistryAddress() {
  return configuredRegistryAddress(pinned, pinned === ARC_MAINNET_PROFILE ? registry : undefined, registry);
}
