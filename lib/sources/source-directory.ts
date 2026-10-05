import type { KeryxDB } from "../db/keryx-db";
import type { PublicReference } from "../public-references/catalog";
import type { Source } from "../types";
import { sourceId as registrySourceId } from "../registry/registry-client";
import { canonicalSourceUrl, claimControlIsFresh, sourceClaimSchema, type SourceClaim } from "./public-source-claim";
import { sourceClaimPolicyForSource } from "./public-source-claim-service";

export interface RegistryEntry {
  source: Source;
  totalEarnedUsdc: number | null;
  citationCount: number | null;
  claim: SourceClaim | null;
  claimPolicyUnavailable: boolean;
  controlFresh: boolean;
}

export interface SourceDirectory {
  registry: { status: "ready" | "unavailable"; entries: RegistryEntry[] };
  publicReferences: { status: "ready" | "unavailable"; entries: PublicReference[] };
  earningsStatus: "ready" | "unavailable";
}

export function unavailableSourceDirectory(): SourceDirectory {
  return {
    registry: { status: "unavailable", entries: [] },
    publicReferences: { status: "unavailable", entries: [] },
    earningsStatus: "unavailable",
  };
}

export function claimMatchesDisplayedSource(claim: SourceClaim, source: Source): boolean {
  try {
    return claim.linkedSourceId === source.id
      && claim.onchainId?.toLowerCase() === source.onchainId?.toLowerCase()
      && claim.canonicalUrl === canonicalSourceUrl(source.url)
      && (!claim.rssUrl || claim.rssUrl === source.rssUrl)
      && !!source.onchainId
      && registrySourceId(claim.ownerWallet as `0x${string}`, source.url).toLowerCase() === source.onchainId.toLowerCase();
  } catch { return false; }
}

/** Read-only presentation snapshot. Listing and earnings availability are independent. */
export async function loadSourceDirectory(db: KeryxDB): Promise<SourceDirectory> {
  const [sources, references, earnings] = await Promise.allSettled([
    Promise.resolve().then(() => db.listSources()),
    Promise.resolve().then(() => {
      if (!db.listPublicReferences) throw new Error("Public references unsupported");
      return db.listPublicReferences();
    }),
    Promise.resolve().then(() => db.creatorLeaderboard()),
  ]);
  const earningsById = new Map(earnings.status === "fulfilled"
    ? earnings.value.map(entry => [entry.sourceId, entry]) : []);
  const entries = sources.status === "fulfilled" ? await Promise.all(sources.value
    .filter(source => source.active !== false)
    .map(async source => {
      let claim: SourceClaim | null = null;
      let claimPolicyUnavailable = false;
      try {
        const value = await sourceClaimPolicyForSource(db, source.id);
        claim = value ? sourceClaimSchema.parse(value) : null;
        if (claim && !claimMatchesDisplayedSource(claim, source)) throw new Error("Claim publisher identity differs");
        claimPolicyUnavailable = !!source.sourceClaimId && (!claim || claim.id !== source.sourceClaimId);
      } catch { claim = null; claimPolicyUnavailable = true; }
      const earned = earningsById.get(source.id);
      return {
        source,
        totalEarnedUsdc: earnings.status === "fulfilled" ? earned?.totalEarnedUsdc ?? 0 : null,
        citationCount: earnings.status === "fulfilled" ? earned?.citationCount ?? 0 : null,
        claim, claimPolicyUnavailable,
        controlFresh: !!claim && claimControlIsFresh(claim),
      };
    })) : [];
  entries.sort((a, b) => (b.totalEarnedUsdc ?? 0) - (a.totalEarnedUsdc ?? 0)
    || Number(!!b.source.onchainId) - Number(!!a.source.onchainId)
    || a.source.name.localeCompare(b.source.name));
  return {
    registry: { status: sources.status === "fulfilled" ? "ready" : "unavailable", entries },
    publicReferences: {
      status: references.status === "fulfilled" ? "ready" : "unavailable",
      entries: references.status === "fulfilled" ? references.value.filter(reference => reference.active) : [],
    },
    earningsStatus: earnings.status === "fulfilled" ? "ready" : "unavailable",
  };
}
