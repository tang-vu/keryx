import { z } from "zod";

import { boundedPortableCopy } from "../research/bounded-portable-json";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { sourceRecencyPublicationDate } from "./source-recency-feed-date";

/** Public syntax only. This does not resolve DNS or restore live observation authority. */
function publicUrlSyntax(raw: string): boolean {
  if (!isWellFormedUtf16(raw) || /[\\\s\u0000-\u001f\u007f]/u.test(raw)) return false;
  try {
    const url = new URL(raw), host = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.href !== raw ||
      host === "localhost" || /\.(?:localhost|local|internal|lan|home\.arpa)$/u.test(host)) return false;
    if (host.startsWith("[")) {
      const value = host.slice(1, -1);
      if (value.includes(".")) return false;
      const [left, right] = value.split("::");
      const a = left ? left.split(":").map(part => Number.parseInt(part, 16)) : [];
      const b = right ? right.split(":").map(part => Number.parseInt(part, 16)) : [];
      const parts = right === undefined ? a : [...a, ...Array<number>(8 - a.length - b.length).fill(0), ...b];
      return parts.length === 8 && parts[0] >= 0x2000 && parts[0] <= 0x3fff &&
        !(parts[0] === 0x2001 && (parts[1] <= 0x01ff || parts[1] === 0x0db8)) &&
        parts[0] !== 0x2002 && !(parts[0] === 0x3fff && parts[1] < 0x1000);
    }
    if (/^\d+\.\d+\.\d+\.\d+$/u.test(host)) {
      const [a, b, c] = host.split(".").map(Number);
      return !([0, 10, 127].includes(a) || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
        a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
        a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
        a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
    }
    return host.includes(".");
  } catch { return false; }
}
const url = z.string().min(1).max(2000).refine(publicUrlSyntax);
const scalar = (maximum: number) => z.string().min(1).max(maximum).refine(value => isWellFormedUtf16(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const iso = z.string().datetime().refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
});
const sha = z.string().regex(/^[a-f0-9]{64}$/u), digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const nativeId = z.object({ field: z.enum(["atom:id", "rss:guid"]), rawValue: scalar(2000) }).strict();
const publication = z.object({ field: z.enum(["atom:published", "rss:pubDate"]), rawValue: scalar(2000), publishedAt: iso }).strict()
  .refine(value => sourceRecencyPublicationDate(value.field, value.rawValue.trim()) === value.publishedAt);
export const sourceRecencyFeedMetadataSchema = z.object({ scope: z.literal("current-feed"), criterion: z.literal("explicit-publication-date"),
  sourceId: scalar(200), feedUrl: url, capturedAt: iso, observationDigest: digest, rawBodySha256: sha,
  membership: z.literal("complete-document"), membershipCount: z.number().int().min(1).max(1000), filteredCount: z.literal(0), truncated: z.literal(false),
  nativeFeedId: scalar(2000).optional(), newestEntry: z.object({ nativeId: nativeId.optional(), title: scalar(2000), itemUrl: url,
    publication, entryMetadataVersion: digest }).strict(),
}).strict().refine(value => Date.parse(value.newestEntry.publication.publishedAt) <= Date.parse(value.capturedAt) && Date.parse(value.capturedAt) <= Date.now())
  .refine(value => value.newestEntry.publication.field === "atom:published" ? value.newestEntry.nativeId?.field === "atom:id" :
    !value.nativeFeedId && (!value.newestEntry.nativeId || value.newestEntry.nativeId.field === "rss:guid"));

const gapReason = z.enum(["newest-feed-observation-unqualified", "unsupported-temporal-form", "ambiguous-feed-urls", "source-binding-unresolved", "question-scan-limit",
  "observation-unqualified", "requirement-unqualified", "source-mismatch", "run-mismatch", "invalid-observation-time", "empty-feed", "entry-identity-unqualified",
  "publication-unqualified", "ambiguous-newest", "catalog-lookup-failed", "catalog-lookup-unqualified", "newest-entry-not-indexed", "catalog-entry-conflict",
  "wanted-version-conflict", "cancelled", "request-scope-unqualified", "read-cap-exhausted", "duplicate-probe", "feed-read-failed", "feed-document-unqualified", "observation-disabled"]);
export const sourceRecencyGapSchema = z.object({ scope: z.enum(["request", "catalog"]), sourceId: scalar(200).optional(),
  sourceName: z.string().max(1000).refine(value => !/\p{Cc}/u.test(value)).optional(), feedUrl: url.optional(), reason: gapReason, observation: sourceRecencyFeedMetadataSchema.optional(),
}).strict().refine(value => value.scope === "catalog" ? !!value.sourceId : !value.sourceId && !value.sourceName && !value.observation)
  .refine(value => !value.observation || value.reason === "newest-entry-not-indexed" && value.scope === "catalog" &&
    value.sourceId === value.observation.sourceId && value.feedUrl === value.observation.feedUrl);

/** Recorded optional metadata. Strict shape validation is not native/feed/payment verification. */
export const sourceRecencyResultSchema = z.object({ version: z.literal(1), scope: z.literal("current-feed"),
  metadataReads: z.number().int().min(0).max(4), observations: z.array(sourceRecencyFeedMetadataSchema).max(4), gaps: z.array(sourceRecencyGapSchema).max(32),
}).strict().refine(value => {
  const unique = new Map<string, string>();
  for (const observation of [...value.observations, ...value.gaps.flatMap(gap => gap.observation ? [gap.observation] : [])]) {
    const exact = JSON.stringify(observation), prior = unique.get(observation.sourceId);
    if (prior && prior !== exact) return false;
    unique.set(observation.sourceId, exact);
  }
  return new Set(value.observations.map(item => item.sourceId)).size === value.observations.length && unique.size <= value.metadataReads;
});
export type SourceRecencyResult = z.infer<typeof sourceRecencyResultSchema>;

function freezeData<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeData(child); Object.freeze(value); }
  return value;
}

/** Validate bounded plain historical JSON. No network, catalog, observer or eligibility is invoked. */
export function projectSourceRecencyResult(value: unknown, now = Date.now()): SourceRecencyResult | undefined {
  try {
    if (!Number.isFinite(now)) return;
    const parsed = sourceRecencyResultSchema.safeParse(boundedPortableCopy(value));
    if (!parsed.success) return;
    const observations = [...parsed.data.observations, ...parsed.data.gaps.flatMap(gap => gap.observation ? [gap.observation] : [])];
    if (observations.some(item => Date.parse(item.capturedAt) > now)) return;
    return freezeData(parsed.data);
  } catch { return; }
}
