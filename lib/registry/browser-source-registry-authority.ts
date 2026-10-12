import { z } from "zod";
import type { ArcNetworkProfile } from "../arc-network-profile";
import { sameRegistryAuthority, sourceRegistryAuthoritySchema, type SourceRegistryAuthority } from "./source-registry-authority-schema";

// Next replaces this exact public property in both page and DedicatedWorker bundles.
const pinnedOrigins = process.env.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS;
/** Critical browser/headless signing never imports the broad server configuration module. */
export function browserSourceRegistryAuthorityForSource(
  source: { onchainId?: string; registryAuthority?: SourceRegistryAuthority }, profile: ArcNetworkProfile
): SourceRegistryAuthority | undefined {
  const node = typeof process !== "undefined" && process.release?.name === "node";
  const text = node ? process.env.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS ?? "" : pinnedOrigins ?? "";
  if (text.length > 8192 || node && (process.env.KERYX_REGISTRY_ORIGINS ?? "") !== text)
    throw new Error("Server and browser registry origins differ");
  const origins = text ? z.array(sourceRegistryAuthoritySchema).min(1).max(4).parse(JSON.parse(text)) : [];
  if (origins.some(origin => origin.network !== profile.networkId) || new Set(origins.map(origin => origin.address)).size !== origins.length)
    throw new Error("Registry origins must be unique and belong to this network");
  if (source.registryAuthority) {
    const authority = sourceRegistryAuthoritySchema.parse(source.registryAuthority);
    if (!origins.some(origin => sameRegistryAuthority(origin, authority))) throw new Error("Source registry origin is outside the reviewed deployment allowlist");
    return authority;
  }
  if (source.onchainId && origins.length) throw new Error("On-chain source requires its immutable original registry binding");
  return undefined;
}
