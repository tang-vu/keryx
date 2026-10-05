import { hasKnownSyntheticFingerprint } from "./evidence-provenance";
import { z } from "zod";
import { researchExports } from "./surface-result";
import { sourceClaimReceiptSchema } from "../sources/public-source-claim";

const text = z.string().max(4096);
const scholarly = z.object({
  provider: z.enum(["crossref", "arxiv"]), recordUrl: text, retrievedAt: text, title: text,
  authors: z.array(text).max(50), authorCount: z.number().int().nonnegative().optional(), authorsTruncated: z.boolean().optional(),
  authorNames: z.array(z.object({ given: text.optional(), family: text.optional(), literal: text.optional() })).max(50).optional(),
  doi: text.optional(), arxivId: text.optional(), workType: z.enum(["journal-article", "preprint", "other"]),
  journal: text.optional(), publishedDate: text.optional(), volume: text.optional(), issue: text.optional(), pages: text.optional(),
  peerReview: z.literal("unknown"), evidenceScope: z.enum(["paper-text", "abstract-page", "publisher-page"]).optional(),
});
const identity = { sourceClaim: sourceClaimReceiptSchema.optional(), accessKind: z.literal("creator-free").optional(),
  contentReceipt: z.object({ bodyHash: text.optional(), deliveryKind: z.enum(["full_text", "excerpt", "abstract", "metadata_only"]),
  storageMode: z.enum(["ipfs_encrypted", "db_encrypted", "db_plaintext"]), plaintextBytes: z.number().int().nonnegative() }).optional(), evidenceProvenance: z.literal("synthetic-demo").optional(), itemId: text.optional(), itemTitle: text.optional(), itemUrl: text.optional(),
  contentVersion: text.optional(), itemPublishedAt: text.optional(), sourceKind: z.literal("public-reference").optional(), scholarly: scholarly.optional() };
const citation = z.object({ marker: text, sourceId: text.default(""), sourceName: text, ...identity,
  weight: z.number().finite().default(0), rewardPlannedUsdc: z.number().finite().nonnegative().default(0), rationale: text.default("") });
const evidence = z.object({ marker: text, sourceId: text, sourceName: text, ...identity,
  quote: z.string().max(240), support: z.number().finite(), qualifiesForAnswer: z.boolean().optional(), qualifiesForReward: z.boolean() });
const claim = z.object({ claimIndex: z.number().int().nonnegative(), claim: text, evidence: z.array(z.unknown()).max(256) });

/** Called only after receipt integrity and original task binding have been checked.
 * Parse the read model separately: an older or malformed optional ledger cannot break recovery. */
export function exportsFromCheckedReceipt(receipt: unknown) {
  const parsed = z.object({ payload: z.object({ citations: z.array(z.unknown()).max(64).optional(),
    claims: z.array(z.unknown()).max(256).optional() }) }).safeParse(receipt);
  const payload = parsed.success ? parsed.data.payload : {};
  const citations = (payload.citations ?? []).flatMap(value => {
    const item = citation.safeParse(value);
    return item.success ? [{ ...item.data, ...(hasKnownSyntheticFingerprint(item.data) ? { evidenceProvenance: "synthetic-demo" as const } : {}), reward: item.data.rewardPlannedUsdc }] : [];
  });
  const claims = (payload.claims ?? []).flatMap(value => {
    const item = claim.safeParse(value); return item.success ? [item.data] : [];
  });
  const records = claims.flatMap(row => row.evidence.flatMap(value => {
    const item = evidence.safeParse(value);
    return item.success ? [{ ...item.data, ...(hasKnownSyntheticFingerprint(item.data) ? { evidenceProvenance: "synthetic-demo" as const, qualifiesForAnswer: false, qualifiesForReward: false, support: 0 } : {}), claimIndex: row.claimIndex, claim: row.claim }] : [];
  }));
  const input = { citations, subClaims: [] as string[], claimCoverage: claims.map(row => ({
    claimIndex: row.claimIndex, claim: row.claim, coverage: 0, coveredBy: [] as string[] })),
    evidence: payload.claims === undefined ? undefined : records };
  return researchExports(input);
}
