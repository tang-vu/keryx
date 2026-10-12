import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { config } from "../config";
import { getBrowserRegistryVersion, getServerRegistryVersion } from "./registry-version";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value)).transform(value => value.toLowerCase() as `0x${string}`);
export const sourceRegistryAuthoritySchema = z.object({
  network: z.enum(["eip155:5042", "eip155:5042002"]), address,
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase() as `0x${string}`),
  deployBlock: z.string().regex(/^(0|[1-9]\d{0,19})$/),
}).strict();
export type SourceRegistryAuthority = z.infer<typeof sourceRegistryAuthoritySchema>;
const originsSchema = z.array(sourceRegistryAuthoritySchema).min(1).max(4);
const publicOrigins = () => process.env.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS;
const network = () => config.networkId ?? config.profile?.networkId;
const version = () => typeof window === "undefined" ? getServerRegistryVersion() : getBrowserRegistryVersion();

/** Explicit deployment allowlist. An API response never enrolls a new registry. */
export function configuredRegistryAuthorities(): SourceRegistryAuthority[] {
  const text = config.registryOrigins ?? "";
  if (!text) return [];
  if (text.length > 8192) throw new Error("Registry origin configuration is unavailable");
  if (typeof window === "undefined" && (process.env.KERYX_REGISTRY_ORIGINS !== text || publicOrigins() !== text))
    throw new Error("Server and browser registry origins differ");
  const origins = originsSchema.parse(JSON.parse(text));
  if (origins.some(origin => origin.network !== network()) || new Set(origins.map(origin => origin.address)).size !== origins.length)
    throw new Error("Registry origins must be unique and belong to this network");
  return origins;
}
export function sameRegistryAuthority(left: SourceRegistryAuthority, right: SourceRegistryAuthority): boolean {
  return canonicalJson(sourceRegistryAuthoritySchema.parse(left)) === canonicalJson(sourceRegistryAuthoritySchema.parse(right));
}
export function assertConfiguredRegistryAuthority(input: SourceRegistryAuthority): SourceRegistryAuthority {
  const authority = sourceRegistryAuthoritySchema.parse(input);
  if (!configuredRegistryAuthorities().some(origin => sameRegistryAuthority(origin, authority)))
    throw new Error("Source registry origin is outside the reviewed deployment allowlist");
  return authority;
}
/** A global selection supplies only the origin for NEW registrations. */
export function configuredRegistrationRegistryAuthority(): SourceRegistryAuthority | undefined {
  const origins = configuredRegistryAuthorities();
  if (!origins.length) return undefined;
  if (!config.registryAddress || config.registryAddress.toLowerCase() !== config.registryReadAddress?.toLowerCase())
    throw new Error("New registration requires matching registry read and write addresses");
  const authority = origins.find(origin => origin.address === config.registryAddress.toLowerCase() && origin.version === version());
  if (!authority || authority.deployBlock !== config.registryDeployBlock)
    throw new Error("Selected registration registry is outside the reviewed origin profiles");
  return authority;
}
/** Bound sources never inherit a changed global registry. */
export function sourceRegistryAuthorityForSource(source: { onchainId?: string; registryAuthority?: SourceRegistryAuthority }): SourceRegistryAuthority | undefined {
  if (source.registryAuthority) return assertConfiguredRegistryAuthority(source.registryAuthority);
  if (source.onchainId && configuredRegistryAuthorities().length)
    throw new Error("On-chain source requires its immutable original registry binding");
  return undefined;
}
export function registryCheckpointKey(authority: SourceRegistryAuthority): string {
  return `keryx:registry-index:v1:${authority.network}:${authority.address}:${authority.version}:${authority.codeHash}:lastSyncedBlock`;
}
/** Browser listing controls accept only configured origins, including retained V1. */
export function assertListingRegistryOrigin(addressValue: string, versionValue: number): void {
  const origins = configuredRegistryAuthorities();
  if (origins.length) {
    if (!origins.some(origin => origin.address === addressValue.toLowerCase() && origin.version === versionValue))
      throw new Error("Listing registry is outside the reviewed origin profiles");
  } else if (addressValue.toLowerCase() !== config.registryAddress.toLowerCase() || versionValue !== version()) {
    throw new Error("Configured listing registry differs");
  }
}
