import { createHash } from "node:crypto";
import { z } from "zod";

const MAX_ITEMS = 1000;
const safeUrl = z.string().max(2000).url().refine(value => {
  try {
    const url = new URL(value);
    return !/[\s\u0000-\u001f\u007f]/u.test(value) && ["http:", "https:"].includes(url.protocol) &&
      !url.username && !url.password && !url.hash;
  } catch { return false; }
});
const isoTime = z.string().datetime().refine(value => {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value;
}, "An exact normalized ISO timestamp is required");
const itemSchema = z.object({
  itemId: z.string().min(1).max(200), itemTitle: z.string().max(1000), itemUrl: safeUrl,
  contentVersion: z.string().min(1).max(300), itemPublishedAt: isoTime.optional(),
  publication: z.object({
    field: z.enum(["atom:published", "rss:pubDate", "atom:updated", "legacy:publishedAt"]),
    rawValue: z.string().min(1).max(200),
  }).strict().optional(),
}).strict();
const snapshotSchema = z.object({
  sourceId: z.string().min(1).max(200), feedUrl: safeUrl, capturedAt: isoTime,
  membership: z.enum(["complete-retained-set", "partial", "unknown"]),
  items: z.array(itemSchema).max(MAX_ITEMS),
}).strict();

/** Internal metadata only: neither this type nor URL equality supplies creator authority. */
export type RetainedSourceSetInput = z.input<typeof snapshotSchema>;
type RetainedItem = Readonly<Omit<z.infer<typeof itemSchema>, "publication"> & {
  publication?: Readonly<NonNullable<z.infer<typeof itemSchema>["publication"]>>;
}>;
export interface RetainedSourceSet {
  readonly sourceId: string;
  readonly feedUrl: string;
  readonly capturedAt: string;
  readonly membership: "complete-retained-set" | "partial" | "unknown";
  readonly items: readonly RetainedItem[];
  readonly digest: string;
}
export interface RetainedSourceRecencyRequirement {
  readonly kind: "newest-retained-feed-entry";
  readonly scope: "frozen-retained-set";
  readonly criterion: "explicit-publication-date";
  readonly feedUrl: string;
}
const requirementSchema = z.object({
  kind: z.literal("newest-retained-feed-entry"), scope: z.literal("frozen-retained-set"),
  criterion: z.literal("explicit-publication-date"), feedUrl: safeUrl,
}).strict();

/**
 * Freeze one coherent metadata cohort. The trusted adapter must supply actual membership
 * completeness and native date fields; an array/refreshedAt/legacy publishedAt cannot infer them.
 * No full text, wallet, price, offer or payment fields are accepted or copied.
 */
export function freezeRetainedSourceSet(input: RetainedSourceSetInput): RetainedSourceSet {
  const parsed = snapshotSchema.parse(input);
  const ids = new Set(parsed.items.map(item => item.itemId));
  if (ids.size !== parsed.items.length) throw new Error("Retained item IDs must be unique");
  const items = Object.freeze(parsed.items.map(item => Object.freeze({ ...item,
    ...(item.publication ? { publication: Object.freeze({ ...item.publication }) } : {}) })));
  const body = { sourceId: parsed.sourceId, feedUrl: new URL(parsed.feedUrl).href,
    capturedAt: parsed.capturedAt, membership: parsed.membership, items };
  const digest = `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;
  return Object.freeze({ ...body, digest });
}

type WithheldReason = "requirement-unqualified" | "source-mismatch" | "membership-unqualified" | "empty-retained-set" |
  "invalid-observation-time" | "unqualified-publication-date" | "ambiguous-newest" | "wanted-version-conflict";
interface SelectionMetadata {
  readonly scope: "frozen-retained-set";
  readonly criterion: "explicit-publication-date";
  readonly sourceId: string;
  readonly feedUrl: string;
  readonly capturedAt: string;
  readonly snapshotDigest: string;
  readonly membershipCount: number;
}
export type RetainedSourceRecencySelection = Readonly<SelectionMetadata & (
  { status: "eligible"; selected: RetainedItem } | { status: "withheld"; reason: WithheldReason }
)>;

function calendarDate(year: number, month: number, day: number): boolean {
  return year >= 1970 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Conservative native date subset; edited-only and legacy parser fallbacks stay unqualified. */
function publicationTime(item: RetainedItem): number | null {
  const field = item.publication?.field, raw = item.publication?.rawValue;
  if (!raw || !item.itemPublishedAt || !["atom:published", "rss:pubDate"].includes(field ?? "")) return null;
  let parts: RegExpMatchArray | null;
  if (field === "atom:published") {
    parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u);
    if (!parts || !calendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]))) return null;
  } else {
    parts = raw.match(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), )?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)? (?:GMT|UTC|[+-](?:[01]\d|2[0-3])[0-5]\d)$/u);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (!parts || !calendarDate(Number(parts[3]), months.indexOf(parts[2]) + 1, Number(parts[1]))) return null;
  }
  const time = new Date(raw);
  return Number.isFinite(time.getTime()) && time.toISOString() === item.itemPublishedAt ? time.getTime() : null;
}

/** Eligibility precedes topical ranking; this never commands BUY/CACHE or authorizes a reward. */
export function selectNewestRetainedSourceItem(requirement: RetainedSourceRecencyRequirement,
  snapshot: RetainedSourceSet, now: number,
  wanted?: Readonly<{ sourceId: string; itemId: string; contentVersion: string }>,
): RetainedSourceRecencySelection {
  const metadata: SelectionMetadata = { scope: "frozen-retained-set", criterion: "explicit-publication-date",
    sourceId: snapshot.sourceId, feedUrl: snapshot.feedUrl, capturedAt: snapshot.capturedAt,
    snapshotDigest: snapshot.digest, membershipCount: snapshot.items.length };
  const withheld = (reason: WithheldReason): RetainedSourceRecencySelection => Object.freeze({ ...metadata, status: "withheld", reason });
  const parsedRequirement = requirementSchema.safeParse(requirement);
  if (!parsedRequirement.success) return withheld("requirement-unqualified");
  if (new URL(parsedRequirement.data.feedUrl).href !== snapshot.feedUrl) return withheld("source-mismatch");
  if (snapshot.membership !== "complete-retained-set") return withheld("membership-unqualified");
  const captured = new Date(snapshot.capturedAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(captured) || captured > now) return withheld("invalid-observation-time");
  if (!snapshot.items.length) return withheld("empty-retained-set");
  let newest: RetainedItem | undefined, newestAt = -Infinity, tied = false;
  for (const item of snapshot.items) {
    const at = publicationTime(item);
    // Never discard an undated/uncertain/future member to call the remainder newest.
    if (at === null || at > captured) return withheld("unqualified-publication-date");
    if (at > newestAt) { newest = item; newestAt = at; tied = false; }
    else if (at === newestAt) tied = true;
  }
  if (tied) return withheld("ambiguous-newest");
  if (wanted && (wanted.sourceId !== snapshot.sourceId || wanted.itemId !== newest!.itemId ||
    wanted.contentVersion !== newest!.contentVersion)) return withheld("wanted-version-conflict");
  return Object.freeze({ ...metadata, status: "eligible", selected: newest! });
}
