import { classifyUsage, type CohortFacts, type CohortClassification } from "../research-audit/usage-cohort";
import { parseRunProvenance, type RunProvenance } from "./run-provenance";

export const USAGE_NETWORKS = ["eip155:5042", "eip155:5042002"] as const;
export interface RunUsage extends CohortClassification {
  version: 1;
  network: typeof USAGE_NETWORKS[number];
  actorEvidenceSha256: string | null;
  fundingEvidenceSha256: string | null;
}
export interface TrustedUsageFacts extends CohortFacts {
  actorEvidenceSha256?: string;
  fundingEvidenceSha256?: string;
}
const contexts = new WeakMap<object, RunUsage>();
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function values(value: unknown): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some(row => !("value" in row))) return;
    return Object.fromEntries(Object.entries(descriptors).map(([key, row]) => [key, row.value]));
  } catch { return; }
}

/** A JSON body/header/option cannot mint this server-local capability. No ownership or spend authority. */
export function createTrustedUsageContext(network: RunUsage["network"], input: TrustedUsageFacts): object {
  const row = values(input);
  if (!row || Object.keys(row).some(key => !["actor", "funding", "scripted", "actorEvidenceSha256", "fundingEvidenceSha256"].includes(key)))
    throw new Error("Invalid trusted usage facts");
  const classification = classifyUsage(row as unknown as CohortFacts);
  if (classification.cohort === "outside" && !digest(row.actorEvidenceSha256)) throw new Error("Outside actor evidence required");
  if (classification.payment !== "unknown" && !digest(row.fundingEvidenceSha256))
    throw new Error("Funding evidence required");
  const token = Object.freeze({});
  const usage: RunUsage = { version: 1, network, ...classification,
    actorEvidenceSha256: digest(row.actorEvidenceSha256) ? row.actorEvidenceSha256 : null,
    fundingEvidenceSha256: digest(row.fundingEvidenceSha256) ? row.fundingEvidenceSha256 : null };
  if (!parseRunUsage(usage)) throw new Error("Invalid trusted usage network");
  contexts.set(token, Object.freeze(usage));
  return token;
}

/** Historical absent/malformed observations remain unknown. Never infer cohort from execution channel. */
export function parseRunUsage(value: unknown): RunUsage | undefined {
  const row = values(value);
  if (!row || Object.keys(row).sort().join() !== "actorEvidenceSha256,cohort,fundingEvidenceSha256,network,payment,version") return;
  if (row.version !== 1 || !USAGE_NETWORKS.includes(row.network as RunUsage["network"])
    || typeof row.cohort !== "string" || !["outside", "team", "scripted", "unknown"].includes(row.cohort)
    || typeof row.payment !== "string" || !["independent", "sponsored", "team", "unknown"].includes(row.payment)) return;
  if (![row.actorEvidenceSha256, row.fundingEvidenceSha256].every(value => value === null || digest(value))) return;
  if (row.cohort !== "outside" && ["independent", "sponsored"].includes(row.payment)) return;
  if (row.cohort === "outside" && !digest(row.actorEvidenceSha256)) return;
  if (row.payment !== "unknown" && !digest(row.fundingEvidenceSha256)) return;
  return { version: 1, network: row.network as RunUsage["network"], cohort: row.cohort as RunUsage["cohort"],
    payment: row.payment as RunUsage["payment"], actorEvidenceSha256: row.actorEvidenceSha256 as string | null,
    fundingEvidenceSha256: row.fundingEvidenceSha256 as string | null };
}

/** Called by the shared server orchestrator, including zero-spend/free bibliography results. */
export function newRunUsage(input: { usageContext?: object; asker?: string; provenance?: RunProvenance },
  network: RunUsage["network"], teamWallets: readonly string[]): RunUsage {
  const qualified = input.usageContext && typeof input.usageContext === "object" ? contexts.get(input.usageContext) : undefined;
  if (qualified?.network === network) return { ...qualified };
  const owned = parseRunProvenance(input.provenance)?.ownershipMethod !== "unknown" && parseRunProvenance(input.provenance) !== undefined;
  const team = owned && typeof input.asker === "string" && teamWallets.some(wallet => wallet.toLowerCase() === input.asker!.toLowerCase());
  return { version: 1, network, cohort: team ? "team" : "unknown", payment: "unknown",
    actorEvidenceSha256: null, fundingEvidenceSha256: null };
}
