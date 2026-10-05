import { describe, expect, it } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import type { Source } from "../types";
import { APPROVED_PUBLIC_REFERENCES } from "../public-references/approved-catalog";
import { claimMatchesDisplayedSource, loadSourceDirectory } from "./source-directory";
import type { SourceClaim } from "./public-source-claim";
import { sourceId as registrySourceId } from "../registry/registry-client";

const source: Source = { id: "unverified", name: "A publisher", url: "https://publisher.example/", description: "Public listing", verified: false, tags: [], authors: [], walletAddress: "0x1", fetchPrice: 0.01, createdAt: "2026-10-05T00:00:00.000Z" };
function database(overrides: Partial<KeryxDB> = {}): KeryxDB {
  return { listSources: async () => [source], listPublicReferences: async () => APPROVED_PUBLIC_REFERENCES, listRecentQueries: async () => [], creatorLeaderboard: async () => [], getSourceClaimForSource: async () => null, ...overrides } as KeryxDB;
}

describe("read-only source directory availability", () => {
  it("keeps public and unverified sources visible without conferring proof or payment", async () => {
    const result = await loadSourceDirectory(database());
    expect(result.registry.entries[0].source.verified).toBe(false);
    expect(result.registry.entries[0].controlFresh).toBe(false);
    expect(result.publicReferences.entries).toHaveLength(5);
    expect(result.registry.entries[0].totalEarnedUsdc).toBe(0);
  });
  it("retains both source collections when earnings fail, with unknown earnings", async () => {
    const result = await loadSourceDirectory(database({ creatorLeaderboard: async () => { throw new Error("offline"); } }));
    expect(result.earningsStatus).toBe("unavailable");
    expect(result.registry.entries[0].totalEarnedUsdc).toBeNull();
    expect(result.registry.entries[0].citationCount).toBeNull();
    expect(result.registry.status).toBe("ready");
    expect(result.publicReferences.status).toBe("ready");
  });
  it("retains public references when creator registry fails", async () => {
    const result = await loadSourceDirectory(database({ listSources: async () => { throw new Error("offline"); } }));
    expect(result.registry.status).toBe("unavailable");
    expect(result.publicReferences.entries).toHaveLength(5);
  });
  it("keeps source collections available when public citation history fails", async () => {
    const result = await loadSourceDirectory(database({ listRecentQueries: async () => { throw new Error("history unavailable"); } }));
    expect(result.citedSources.status).toBe("unavailable");
    expect(result.publicReferences.status).toBe("ready");
    expect(result.registry.status).toBe("ready");
  });
  it("distinguishes unsupported or failed references from a confirmed empty list", async () => {
    expect((await loadSourceDirectory(database({ listPublicReferences: undefined }))).publicReferences.status).toBe("unavailable");
    expect((await loadSourceDirectory(database({ listPublicReferences: async () => [] }))).publicReferences).toEqual({ status: "ready", entries: [] });
  });
  it("does not resurface deactivated entries", async () => {
    const result = await loadSourceDirectory(database({ listSources: async () => [{ ...source, active: false }], listPublicReferences: async () => APPROVED_PUBLIC_REFERENCES.map(reference => ({ ...reference, active: false })) }));
    expect(result.registry.entries).toEqual([]);
    expect(result.publicReferences.entries).toEqual([]);
  });
  it("marks failed claim inspection on just the affected listing", async () => {
    const result = await loadSourceDirectory(database({ getSourceClaimForSource: async () => { throw new Error("invalid retained policy"); } }));
    expect(result.registry.entries[0].claimPolicyUnavailable).toBe(true);
    expect(result.registry.entries[0].controlFresh).toBe(false);
    expect(result.registry.status).toBe("ready");
  });
  it("cannot attach recorded control to a different displayed publisher or feed", () => {
    const ownerWallet = `0x${"1".repeat(40)}` as const;
    const owned = { ...source, walletAddress: ownerWallet, onchainId: registrySourceId(ownerWallet, source.url), rssUrl: "https://publisher.example/feed" };
    const claim = { linkedSourceId: source.id, onchainId: owned.onchainId, canonicalUrl: source.url, rssUrl: owned.rssUrl, ownerWallet } as SourceClaim;
    expect(claimMatchesDisplayedSource(claim, owned)).toBe(true);
    expect(claimMatchesDisplayedSource(claim, { ...owned, url: "https://different.example/" })).toBe(false);
    expect(claimMatchesDisplayedSource(claim, { ...owned, rssUrl: "https://publisher.example/other-feed" })).toBe(false);
    expect(claimMatchesDisplayedSource({ ...claim, ownerWallet: `0x${"2".repeat(40)}` }, owned)).toBe(false);
    expect(claimMatchesDisplayedSource(claim, { ...owned, walletAddress: `0x${"3".repeat(40)}` })).toBe(true);
    expect(claimMatchesDisplayedSource(claim, { ...owned, onchainId: registrySourceId(ownerWallet, `${owned.url}#section`), url: `${owned.url}#section` })).toBe(false);
  });
});
