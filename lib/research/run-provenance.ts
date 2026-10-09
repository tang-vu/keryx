/** Trusted ingress metadata. Client names, IPs and user agents establish none of these fields. */
export const RUN_SURFACES = ["web", "remote-mcp", "stdio-mcp", "api", "agent-to-agent", "telegram",
  "discord", "slack", "extension", "desktop", "cli", "unknown"] as const;
export const RUN_OWNERSHIP_METHODS = ["session", "api-key", "verified-payer", "unknown"] as const;
export interface RunProvenance {
  version: 1;
  surface: typeof RUN_SURFACES[number];
  ownershipMethod: typeof RUN_OWNERSHIP_METHODS[number];
}

/** Copy closed metadata only. Missing historical metadata stays absent; never derive it from origin. */
export function parseRunProvenance(value: unknown): RunProvenance | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(fields).length !== 3 || Object.values(fields).some(field => !("value" in field))) return;
    const version = fields.version?.value, surface = fields.surface?.value, ownershipMethod = fields.ownershipMethod?.value;
    if (version !== 1 || !RUN_SURFACES.includes(surface) || !RUN_OWNERSHIP_METHODS.includes(ownershipMethod)) return;
    return { version, surface, ownershipMethod };
  } catch { return; }
}

/** Only server adapters supply provenance; it describes an existing actor, never creates one. */
export function newRunProvenance(input: { provenance?: RunProvenance; asker?: string }): RunProvenance {
  const parsed = parseRunProvenance(input.provenance);
  return { version: 1, surface: parsed?.surface ?? "unknown",
    ownershipMethod: input.asker ? parsed?.ownershipMethod ?? "unknown" : "unknown" };
}

/** Both writers use the same closed snapshot, without rewriting absent historical metadata. */
export function recordedRunProvenance<T extends { provenance?: RunProvenance; asker?: string }>(run: T): T {
  return run.provenance === undefined ? run : { ...run, provenance: newRunProvenance(run) };
}
