import { MIN_REWARD_SUPPORT } from "../agent/evidence-ledger";
import type { ResearchMode } from "../types";

export const A2A_RESEARCH_PACKAGE_SCHEMA = "urn:keryx:a2a-research-package:1" as const;
export const A2A_RESEARCH_PACKAGE_VERSION = "1.0.0" as const;

export interface A2aResearchPackage {
  schema: typeof A2A_RESEARCH_PACKAGE_SCHEMA;
  id: "keryx-quick" | "keryx-deep";
  version: string;
  researchMode: ResearchMode;
  execution: {
    attentionLimit: number;
    reevaluateRounds: number;
  };
  serviceLevel: {
    kind: "provisional_slo";
    targetCompletionMs: number;
    startsAt: "accepted_at";
    remedy: "none";
  };
  quality: {
    measurement: "evidence-ledger-v1";
    groundingThreshold: typeof MIN_REWARD_SUPPORT;
    commitment: "best_effort";
  };
}

const PACKAGE_REGISTRY: Record<string, Record<ResearchMode, A2aResearchPackage>> = {
  [A2A_RESEARCH_PACKAGE_VERSION]: {
    quick: {
      schema: A2A_RESEARCH_PACKAGE_SCHEMA,
      id: "keryx-quick",
      version: A2A_RESEARCH_PACKAGE_VERSION,
      researchMode: "quick",
      execution: { attentionLimit: 2, reevaluateRounds: 0 },
      serviceLevel: {
        kind: "provisional_slo",
        targetCompletionMs: 180_000,
        startsAt: "accepted_at",
        remedy: "none",
      },
      quality: {
        measurement: "evidence-ledger-v1",
        groundingThreshold: MIN_REWARD_SUPPORT,
        commitment: "best_effort",
      },
    },
    deep: {
      schema: A2A_RESEARCH_PACKAGE_SCHEMA,
      id: "keryx-deep",
      version: A2A_RESEARCH_PACKAGE_VERSION,
      researchMode: "deep",
      execution: { attentionLimit: 4, reevaluateRounds: 1 },
      serviceLevel: {
        kind: "provisional_slo",
        targetCompletionMs: 300_000,
        startsAt: "accepted_at",
        remedy: "none",
      },
      quality: {
        measurement: "evidence-ledger-v1",
        groundingThreshold: MIN_REWARD_SUPPORT,
        commitment: "best_effort",
      },
    },
  },
};

function clonePackage(value: A2aResearchPackage): A2aResearchPackage {
  return {
    ...value,
    execution: { ...value.execution },
    serviceLevel: { ...value.serviceLevel },
    quality: { ...value.quality },
  };
}

export function a2aResearchPackage(mode: ResearchMode): A2aResearchPackage {
  return clonePackage(PACKAGE_REGISTRY[A2A_RESEARCH_PACKAGE_VERSION]![mode]);
}

export function a2aResearchPackageForVersion(
  mode: ResearchMode,
  version: string,
): A2aResearchPackage | null {
  if (!Object.prototype.hasOwnProperty.call(PACKAGE_REGISTRY, version)) return null;
  const value = PACKAGE_REGISTRY[version]?.[mode];
  return value ? clonePackage(value) : null;
}

export function listA2aResearchPackages(): A2aResearchPackage[] {
  return supportedA2aPackageVersions().flatMap((version) =>
    (["quick", "deep"] as const).map((mode) =>
      clonePackage(PACKAGE_REGISTRY[version]![mode]),
    ),
  );
}

export function supportedA2aPackageVersions(): string[] {
  return Object.keys(PACKAGE_REGISTRY).sort();
}

export function acceptsA2aPackageVersion(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && Object.prototype.hasOwnProperty.call(PACKAGE_REGISTRY, value));
}

export function a2aPackageFingerprintInput(value: A2aResearchPackage | null | undefined): string {
  return value ? stableJson(value) : "legacy-unversioned";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
