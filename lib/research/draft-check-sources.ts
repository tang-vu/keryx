import { z } from "zod";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { hasKnownSyntheticFingerprint } from "./evidence-provenance";
import { hasKnownSeedFingerprint } from "./seed-evidence-fingerprints";
import type { GatheredContent } from "../llm/reasoning-engine";
import type { DraftReference } from "./draft-check-references";

const text = (max: number) => z.string().min(1).max(max).refine(isWellFormedUtf16).refine(value => !!value.trim());
export const draftSourceUrlSchema = z.string().min(1).max(2048).url().refine(isWellFormedUtf16).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !/[<>"\s\p{Cc}]/u.test(value);
  } catch { return false; }
});
/** Recorded identity is a binding, never authentication, completeness or payout authority. */
export const draftSourceIdentitySchema = z.object({
  sourceId: text(200), itemId: text(200), itemUrl: draftSourceUrlSchema, contentVersion: text(200),
  doi: text(1000).optional(), bodyHash: text(200).optional(),
  evidenceProvenance: z.literal("synthetic-demo").optional(),
}).strict();
export type DraftSourceIdentity = z.infer<typeof draftSourceIdentitySchema>;
export const syntheticDraftIdentity = (identity: DraftSourceIdentity) => identity.evidenceProvenance === "synthetic-demo"
  || hasKnownSeedFingerprint(undefined, identity.itemUrl, identity.bodyHash);

function doi(value: string): string | undefined {
  const literal = /^10\.\d{4,9}\/[^\s?#]+$/i;
  if (literal.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["doi.org", "dx.doi.org"].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port || url.search) return;
    const path = url.pathname.slice(1);
    return literal.test(path) ? path.toLowerCase() : undefined;
  } catch { return; }
}
function locator(value: string): string {
  const url = new URL(value);
  // A requested fragment addresses the same document, not a new work/version.
  url.hash = "";
  return url.href;
}
export function draftWorkBinding(reference: DraftReference, identity: DraftSourceIdentity): "matched" | "different-work" | "unresolved" {
  if (reference.status === "unresolved") return "unresolved";
  const observedDoi = doi(identity.doi ?? "") ?? doi(identity.itemUrl);
  if (reference.doi && observedDoi) return reference.doi.toLowerCase() === observedDoi ? "matched" : "different-work";
  if (reference.url) return locator(reference.url) === locator(identity.itemUrl) ? "matched" : "different-work";
  return "unresolved";
}

/** Adapter for an OWNER-ADMITTED private run's completed reads. It neither executes
 * the agent nor accepts BUY/CACHE/payment records as proof of a successful read.
 * Caller must retain the existing private execution/owner authority. No source
 * body is loaded from public history, live caches, metadata or a newer version. */
export function draftSourcesFromReads(references: readonly DraftReference[], gathered: readonly GatheredContent[]) {
  const sources: Array<{ reference: string; coverage: "partial"; text: string; identity: DraftSourceIdentity }> = [];
  for (const reference of references) {
    const matching = gathered.flatMap(read => {
      const parsed = draftSourceIdentitySchema.safeParse({ sourceId: read.sourceId, itemId: read.itemId,
        itemUrl: read.itemUrl, contentVersion: read.contentVersion,
        ...(read.scholarly?.doi ? { doi: read.scholarly.doi } : {}),
        ...(read.contentReceipt?.bodyHash ? { bodyHash: read.contentReceipt.bodyHash } : {}) });
      if (!parsed.success || read.evidenceProvenance === "synthetic-demo" || hasKnownSyntheticFingerprint(read)
        || !read.text?.trim() || read.text.length > 40_000 || !isWellFormedUtf16(read.text)
        || draftWorkBinding(reference, parsed.data) !== "matched") return [];
      return [{ read, identity: parsed.data }];
    });
    // Never choose arbitrarily between versions or combine separate retained bodies.
    if (matching.length !== 1) continue;
    sources.push({ reference: reference.key, coverage: "partial", text: matching[0].read.text, identity: matching[0].identity });
  }
  return sources;
}
