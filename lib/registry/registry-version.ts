/** Explicit deployment profile: never guess a registry version from an RPC error. */
export type RegistryVersion = 1 | 2 | 3;

export function parseRegistryVersion(value: string | undefined): RegistryVersion {
  if (value === undefined || value === "1") return 1;
  if (value === "2") return 2;
  if (value === "3") return 3;
  throw new Error("Unsupported registry version. Configure matching registry version values.");
}

export function serverRegistryVersion(privateValue: string | undefined, publicValue: string | undefined): RegistryVersion {
  const privateVersion = parseRegistryVersion(privateValue);
  const publicVersion = parseRegistryVersion(publicValue);
  if (privateVersion !== publicVersion) throw new Error("Server and browser registry versions differ.");
  return privateVersion;
}

export function getServerRegistryVersion(): RegistryVersion {
  return serverRegistryVersion(process.env.KERYX_REGISTRY_VERSION, process.env.NEXT_PUBLIC_KERYX_REGISTRY_VERSION);
}

// Keep the exact NEXT_PUBLIC property reference for Next's build-time replacement.
// A runtime environment change cannot alter already-bundled signing authority.
const pinnedBrowserVersion = process.env.NEXT_PUBLIC_KERYX_REGISTRY_VERSION;
export function getBrowserRegistryVersion(): RegistryVersion {
  return parseRegistryVersion(pinnedBrowserVersion);
}
