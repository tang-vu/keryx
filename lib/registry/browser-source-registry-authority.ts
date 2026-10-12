import { z } from "zod";
import type { ArcNetworkProfile } from "../arc-network-profile";
import { browserPaymentProfile, browserRegistryAddress } from "../browser-payment-profile";
import { sameRegistryAuthority, sourceRegistryAuthoritySchema, type SourceRegistryAuthority } from "./source-registry-authority-schema";

// Next replaces this exact public property in both page and DedicatedWorker bundles.
const pinnedOrigins = process.env.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS;
function configuredBrowserRegistryAuthorities(profile: ArcNetworkProfile): SourceRegistryAuthority[] {
  const node = typeof process !== "undefined" && process.release?.name === "node";
  const text = node ? process.env.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS ?? "" : pinnedOrigins ?? "";
  if (text.length > 8192 || node && (process.env.KERYX_REGISTRY_ORIGINS ?? "") !== text)
    throw new Error("Server and browser registry origins differ");
  const origins = text ? z.array(sourceRegistryAuthoritySchema).min(1).max(4).parse(JSON.parse(text)) : [];
  if (origins.some(origin => origin.network !== profile.networkId) || new Set(origins.map(origin => origin.address)).size !== origins.length)
    throw new Error("Registry origins must be unique and belong to this network");
  return origins;
}
/** Critical browser/headless signing never imports the broad server configuration module. */
export function browserSourceRegistryAuthorityForSource(
  source: { onchainId?: string; registryAuthority?: SourceRegistryAuthority }, profile: ArcNetworkProfile
): SourceRegistryAuthority | undefined {
  const origins = configuredBrowserRegistryAuthorities(profile);
  if (source.registryAuthority) {
    const authority = sourceRegistryAuthoritySchema.parse(source.registryAuthority);
    if (!origins.some(origin => sameRegistryAuthority(origin, authority))) throw new Error("Source registry origin is outside the reviewed deployment allowlist");
    return authority;
  }
  if (source.onchainId && origins.length) throw new Error("On-chain source requires its immutable original registry binding");
  return undefined;
}
/** Listing controls use only compiled public pins, including retained V1 origins. */
export function assertBrowserListingRegistryOrigin(addressValue: string, versionValue: number): void {
  const origins = configuredBrowserRegistryAuthorities(browserPaymentProfile());
  if (origins.length) {
    if (!origins.some(origin => origin.address === addressValue.toLowerCase() && origin.version === versionValue))
      throw new Error("Listing registry is outside the reviewed origin profiles");
    return;
  }
  // Keep this exact public reference inside the listing-only fallback. Next
  // replaces it at build time; unrelated signer bundles need no version capture.
  const version = process.env.NEXT_PUBLIC_KERYX_REGISTRY_VERSION;
  if (version !== undefined && version !== "1" && version !== "2" && version !== "3")
    throw new Error("Unsupported registry version. Configure matching registry version values.");
  const registry = browserRegistryAddress();
  if (/^0x0{40}$/i.test(registry) || addressValue.toLowerCase() !== registry.toLowerCase() || versionValue !== Number(version ?? "1"))
    throw new Error("Configured listing registry differs");
}
