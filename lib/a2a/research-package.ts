import { A2A_RESEARCH_PACKAGE_SCHEMA, a2aResearchPackageForVersion, a2aPackageFingerprintInput, type A2aResearchPackage } from "./research-package-definition";
export * from "./research-package-definition";
import crypto from "node:crypto";
import { deriveConfidence } from "../agent/confidence";
import { MIN_REWARD_SUPPORT } from "../agent/evidence-ledger";
import type { QueryRun, ResearchMode } from "../types";

export interface A2aServiceReceipt {
  packageId: A2aResearchPackage["id"];
  packageVersion: A2aResearchPackage["version"];
  outcome: "completed" | "failed";
  acceptedAt: string;
  startedAt: string | null;
  finishedAt: string;
  queueDurationMs: number | null;
  executionDurationMs: number | null;
  totalDurationMs: number;
  targetCompletionMs: number;
  targetMet: boolean;
  objectiveKind: "provisional_slo";
  remedy: "none";
  quality?: {
    measurement: "evidence-ledger-v1";
    groundingThreshold: typeof MIN_REWARD_SUPPORT;
    status: "measured" | "unavailable";
    claimCount: number;
    measuredClaims: number;
    groundedClaims: number;
    groundedClaimRate: number | null;
    qualifyingEvidence: number;
    rewardedCitations: number;
    confidence: ReturnType<typeof deriveConfidence>;
  };
  portableReceiptUrl?: string;
}

export interface A2aServiceStatus {
  packageId: A2aResearchPackage["id"];
  packageVersion: A2aResearchPackage["version"];
  state: "queued" | "processing" | "review_required";
  acceptedAt: string;
  startedAt: string | null;
  targetCompletionAt: string;
  targetCompletionMs: number;
  elapsedMs: number;
  targetBreached: boolean;
  objectiveKind: "provisional_slo";
  remedy: "none";
}

export function isSupportedA2aResearchPackage(
  value: A2aResearchPackage | null | undefined,
  mode?: ResearchMode,
): value is A2aResearchPackage {
  if (!value || value.schema !== A2A_RESEARCH_PACKAGE_SCHEMA) return false;
  const expected = a2aResearchPackageForVersion(mode ?? value.researchMode, value.version);
  return !!expected && a2aResearchPackageFingerprint(value) === a2aResearchPackageFingerprint(expected);
}

export function a2aResearchPackageFingerprint(
  value: A2aResearchPackage | null | undefined,
): string {
  return crypto
    .createHash("sha256")
    .update(a2aPackageFingerprintInput(value))
    .digest("hex");
}

export function completedA2aServiceReceipt(input: {
  researchPackage: A2aResearchPackage;
  acceptedAt: string;
  startedAt: string | null;
  run: QueryRun;
  baseUrl?: string;
}): A2aServiceReceipt {
  const acceptedMs = requiredTimestamp(input.acceptedAt, "acceptedAt");
  const startedMs = input.startedAt
    ? requiredTimestamp(input.startedAt, "startedAt")
    : acceptedMs;
  const finishedMs = requiredTimestamp(input.run.createdAt, "run.createdAt");
  const subClaims = Array.isArray(input.run.subClaims) ? input.run.subClaims : [];
  const claimCount = subClaims.length;
  const coverage = Array.isArray(input.run.claimCoverage) ? input.run.claimCoverage : [];
  const measuredClaims = coverage.length;
  const groundedClaims = coverage.filter(
    (claim) => claim.coverage >= input.researchPackage.quality.groundingThreshold,
  ).length;
  const qualityMeasured =
    claimCount > 0 &&
    measuredClaims === claimCount &&
    coverage.every(
      (claim, index) => claim.claimIndex === index && claim.claim === subClaims[index],
    );
  const totalDurationMs = Math.max(0, finishedMs - acceptedMs);
  return {
    packageId: input.researchPackage.id,
    packageVersion: input.researchPackage.version,
    outcome: "completed",
    acceptedAt: new Date(acceptedMs).toISOString(),
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    queueDurationMs: Math.max(0, startedMs - acceptedMs),
    executionDurationMs:
      typeof input.run.durationMs === "number" && Number.isFinite(input.run.durationMs)
        ? Math.max(0, Math.round(input.run.durationMs))
        : Math.max(0, finishedMs - startedMs),
    totalDurationMs,
    targetCompletionMs: input.researchPackage.serviceLevel.targetCompletionMs,
    targetMet: totalDurationMs <= input.researchPackage.serviceLevel.targetCompletionMs,
    objectiveKind: input.researchPackage.serviceLevel.kind,
    remedy: input.researchPackage.serviceLevel.remedy,
    quality: {
      measurement: input.researchPackage.quality.measurement,
      groundingThreshold: input.researchPackage.quality.groundingThreshold,
      status: qualityMeasured ? "measured" : "unavailable",
      claimCount,
      measuredClaims,
      groundedClaims,
      groundedClaimRate: qualityMeasured ? round(groundedClaims / claimCount) : null,
      qualifyingEvidence: (Array.isArray(input.run.evidence) ? input.run.evidence : []).filter(
        (item) => item.qualifiesForReward,
      ).length,
      rewardedCitations: Array.isArray(input.run.citations) ? input.run.citations.length : 0,
      confidence: deriveConfidence(input.run),
    },
    portableReceiptUrl: `${input.baseUrl ?? ""}/api/dispatch/${encodeURIComponent(input.run.id)}/receipt`,
  };
}

export function failedA2aServiceReceipt(input: {
  researchPackage: A2aResearchPackage;
  acceptedAt: string;
  startedAt: string | null;
  finishedAt: string;
}): A2aServiceReceipt {
  const acceptedMs = requiredTimestamp(input.acceptedAt, "acceptedAt");
  const startedMs = input.startedAt
    ? requiredTimestamp(input.startedAt, "startedAt")
    : null;
  const finishedMs = requiredTimestamp(input.finishedAt, "finishedAt");
  const totalDurationMs = Math.max(0, finishedMs - acceptedMs);
  return {
    packageId: input.researchPackage.id,
    packageVersion: input.researchPackage.version,
    outcome: "failed",
    acceptedAt: new Date(acceptedMs).toISOString(),
    startedAt: startedMs === null ? null : new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    queueDurationMs: startedMs === null ? null : Math.max(0, startedMs - acceptedMs),
    executionDurationMs: startedMs === null ? null : Math.max(0, finishedMs - startedMs),
    totalDurationMs,
    targetCompletionMs: input.researchPackage.serviceLevel.targetCompletionMs,
    targetMet: false,
    objectiveKind: input.researchPackage.serviceLevel.kind,
    remedy: input.researchPackage.serviceLevel.remedy,
  };
}

export function pendingA2aServiceStatus(input: {
  researchPackage: A2aResearchPackage;
  state: A2aServiceStatus["state"];
  acceptedAt: string;
  startedAt: string | null;
  nowMs?: number;
}): A2aServiceStatus {
  const acceptedMs = requiredTimestamp(input.acceptedAt, "acceptedAt");
  const nowMs = input.nowMs ?? Date.now();
  const targetMs = input.researchPackage.serviceLevel.targetCompletionMs;
  return {
    packageId: input.researchPackage.id,
    packageVersion: input.researchPackage.version,
    state: input.state,
    acceptedAt: new Date(acceptedMs).toISOString(),
    startedAt: input.startedAt
      ? new Date(requiredTimestamp(input.startedAt, "startedAt")).toISOString()
      : null,
    targetCompletionAt: new Date(acceptedMs + targetMs).toISOString(),
    targetCompletionMs: targetMs,
    elapsedMs: Math.max(0, Math.round(nowMs - acceptedMs)),
    targetBreached: nowMs > acceptedMs + targetMs,
    objectiveKind: input.researchPackage.serviceLevel.kind,
    remedy: input.researchPackage.serviceLevel.remedy,
  };
}

function requiredTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`A2A ${field} timestamp is invalid`);
  return parsed;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
