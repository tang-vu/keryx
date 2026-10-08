import { requestedSourceUrls } from "../research/source-requirements";
import type { CurrentFeedCatalogSelection } from "./retained-recency-adapter";
import type { SourceRecencyFeedRead } from "./source-recency-feed";
import { projectSourceRecencyResult } from "./source-recency-result";

type RecencyGapReason = "newest-feed-observation-unqualified" | "unsupported-temporal-form" |
  "ambiguous-feed-urls" | "source-binding-unresolved" | "question-scan-limit";
type ObservedRecencyGapReason = Extract<CurrentFeedCatalogSelection, { status: "withheld" }>["reason"] |
  Extract<SourceRecencyFeedRead, { status: "withheld" }>["reason"] | "observation-disabled";

/** Portable selection metadata only; it cannot authorize a body read, price or creator reward. */
export interface SourceRecencyFeedMetadata {
  readonly scope: "current-feed";
  readonly criterion: "explicit-publication-date";
  readonly sourceId: string;
  readonly feedUrl: string;
  readonly capturedAt: string;
  readonly observationDigest: string;
  readonly rawBodySha256: string;
  readonly membership: "complete-document";
  readonly membershipCount: number;
  readonly filteredCount: 0;
  readonly truncated: false;
  readonly nativeFeedId?: string;
  readonly newestEntry: Readonly<{
    nativeId?: Readonly<{ field: "atom:id" | "rss:guid"; rawValue: string }>;
    title: string;
    itemUrl: string;
    publication: Readonly<{ field: "atom:published" | "rss:pubDate"; rawValue: string; publishedAt: string }>;
    entryMetadataVersion: string;
  }>;
}

/** A narrow safety constraint from the caller's original text, never model targets or tags. */
export interface SourceRecencyRequirement {
  readonly kind: "newest-feed-entry";
  readonly status: "explicit-single-feed" | "unsupported";
  readonly binding: "exact-feeds" | "unresolved";
  readonly feedUrls: readonly string[];
  readonly reason: RecencyGapReason;
  readonly originalSpan: Readonly<{ start: number; end: number }>;
}

export interface SourceRecencyGap {
  readonly scope: "request" | "catalog";
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly feedUrl?: string;
  readonly reason: RecencyGapReason | ObservedRecencyGapReason;
  readonly observation?: Readonly<SourceRecencyFeedMetadata>;
}

/** URL identity only. This performs no DNS, fetching, refresh or authority check. */
function feedIdentity(value: string | undefined): string | null {
  if (!value || value.length > 2000 || /[\s\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) return null;
    return url.href;
  } catch { return null; }
}

/** Later sentence commands are refusal scope only, never a new native-feed capability. */
function contextualRecencyStart(question: string, families: readonly RegExp[]): number | null {
  let scanned = 0, quote: string | null = null;
  for (const boundary of question.matchAll(/(?:^|[.!?]["'\u2019\u201d`]*\s+|\n)\s*/gu)) {
    const start = boundary.index! + boundary[0].length;
    // Track ordinary quoted/code examples. Apostrophes inside words are not quote delimiters.
    while (scanned < start) {
      const index = scanned++, char = question[index];
      if (question[index - 1] === "\\") continue;
      if (quote) {
        if (char === quote && !((quote === "'" || quote === "\u2019") &&
          /[\p{L}\p{N}]/u.test(question[index - 1] ?? "") && /[\p{L}\p{N}]/u.test(question[index + 1] ?? ""))) quote = null;
      } else if (char === '"' || char === "`") quote = char;
      else if (char === "\u201c") quote = "\u201d";
      else if (char === "\u2018") quote = "\u2019";
      else if (char === "'" && !/[\p{L}\p{N}]/u.test(question[index - 1] ?? "")) quote = char;
    }
    if (quote) continue;
    const command = question.slice(start).replace(/^in\s+(?:English|Vietnamese),\s*/iu, "");
    if (families.some(family => family.test(command))) return start;
  }
  return null;
}

/**
 * Qualified native forms stay at the beginning of the original question. A later positive
 * sentence command preserves a visible hold without inferring scope from surrounding prose.
 * This does not claim general temporal-language understanding or infer ordering, freshness,
 * completeness, stable/prerelease status or an observation from retained rows.
 */
export function recognizeSourceRecency(question: string): SourceRecencyRequirement | null {
  const bounded = question.slice(0, 30000);
  const family = /^\s*(?:please\s+)?(?:name|identify|find|compare)\s+(?:the\s+)?(?:newest|latest)\s+(?:(?:stable|prerelease|non-prerelease)\s+)?(?:releases?|versions?|entries|entry|articles?)\b/iu;
  const viFamily = /^\s*(?:hãy\s+)?(?:nêu|xác định|tìm|so sánh)\s+bản phát hành\s+(?:ổn định\s+)?mới nhất\b/iu;
  const initialCommand = family.test(bounded) || viFamily.test(bounded);
  const contextualStart = initialCommand ? null : contextualRecencyStart(bounded, [family, viFamily]);
  if (!initialCommand && contextualStart === null) return null;
  const forms = [
    /^\s*(?:please\s+)?(?:name|identify|find)\s+the\s+(?:newest|latest)\s+release\s+(?:actually\s+)?in\s+(https?:\/\/[^\s<>"'`]+)/iu,
    /^\s*(?:hãy\s+)?(?:nêu|xác định|tìm)\s+bản phát hành\s+mới nhất\s+(?:trong|từ)\s+(https?:\/\/[^\s<>"'`]+)/iu,
  ];
  const match = forms.map(form => form.exec(bounded)).find(value => value !== null);
  const supplied = requestedSourceUrls(question);
  const identities = supplied.urls.map(feedIdentity);
  const feedUrls = [...new Set(identities.filter((url): url is string => url !== null))];
  const incomplete = question.length > bounded.length || !!supplied.scanTruncated || supplied.omitted > 0;
  const unresolved = incomplete || feedUrls.length === 0 || identities.some(url => url === null);
  const unsupportedForm = contextualStart !== null || !match || /\b(?:stable|prerelease|non-prerelease|before|after|cutoff|cached|retained|among|compare)\b|(?:^|[^\p{L}\p{N}])(?:trước|sau|ổn định|đã lưu)(?=$|[^\p{L}\p{N}])/iu.test(bounded);
  const reason: RecencyGapReason = incomplete ? "question-scan-limit" : unresolved ? "source-binding-unresolved"
    : feedUrls.length > 1 ? "ambiguous-feed-urls" : unsupportedForm ? "unsupported-temporal-form" : "newest-feed-observation-unqualified";
  const status = reason === "newest-feed-observation-unqualified" ? "explicit-single-feed" : "unsupported";
  return Object.freeze({ kind: "newest-feed-entry", status, binding: unresolved ? "unresolved" : "exact-feeds",
    feedUrls: Object.freeze(feedUrls), reason,
    originalSpan: Object.freeze({ start: contextualStart ?? 0, end: status === "unsupported" ? bounded.length : match![0].length }) });
}

/** A missing catalog match cannot erase the caller's unresolved request. */
export function sourceRecencyRequestGaps(requirement: SourceRecencyRequirement | null): SourceRecencyGap[] {
  if (!requirement) return [];
  return (requirement.feedUrls.length ? requirement.feedUrls : [undefined]).map(feedUrl =>
    Object.freeze({ scope: "request" as const, ...(feedUrl ? { feedUrl } : {}), reason: requirement.reason }));
}

/** Retained paid items and public refreshedAt/ten-item snapshots cannot qualify current newest. */
export function sourceRecencyGap(
  requirement: SourceRecencyRequirement | null,
  source: { id: string; name: string; rssUrl?: string; url?: string },
): SourceRecencyGap | null {
  if (!requirement) return null;
  // An exact registered resource URL is also affected when a legacy row has no RSS field.
  // This is refusal scope only; equality never establishes that the resource is a feed.
  const feedUrl = [feedIdentity(source.rssUrl), feedIdentity(source.url)].find(url => url !== null && requirement.feedUrls.includes(url));
  if (requirement.binding === "exact-feeds" && !feedUrl) return null;
  return Object.freeze({ scope: "catalog", sourceId: source.id, sourceName: source.name,
    ...(requirement.binding === "exact-feeds" && feedUrl ? { feedUrl } : {}), reason: requirement.reason });
}

/** Safe portable diagnostic; it does not claim zero service/model costs or refund prior tolls. */
export function sourceRecencyReport(gaps: readonly SourceRecencyGap[], vi: boolean): string {
  if (!gaps.length) return "";
  const observed = gaps.filter(hasUnindexedObservedWinner);
  if (observed.length) {
    const feeds = new Set(observed.map(gap => gap.feedUrl));
    const remaining = gaps.filter(gap => !hasUnindexedObservedWinner(gap) &&
      !(gap.reason === "newest-feed-observation-unqualified" && feeds.has(gap.feedUrl)));
    const records = observed.slice(0, 8).map(gap => {
      const metadata = gap.observation!, entry = metadata.newestEntry;
      const nativeId = entry.nativeId ? `; ${entry.nativeId.field}: ${diagnosticText(entry.nativeId.rawValue)}` : "";
      return vi
        ? `- Feed ${diagnosticText(metadata.feedUrl)}, quan sát lúc ${metadata.capturedAt} (${metadata.membershipCount} mục trong tài liệu): ${diagnosticText(entry.title)} — ${diagnosticText(entry.itemUrl)}. Ngày xuất bản ${entry.publication.field}: ${diagnosticText(entry.publication.rawValue)} (${entry.publication.publishedAt})${nativeId}.`
        : `- Feed ${diagnosticText(metadata.feedUrl)}, observed at ${metadata.capturedAt} (${metadata.membershipCount} document entries): ${diagnosticText(entry.title)} — ${diagnosticText(entry.itemUrl)}. Publication ${entry.publication.field}: ${diagnosticText(entry.publication.rawValue)} (${entry.publication.publishedAt})${nativeId}.`;
    }).join("\n");
    const report = vi
      ? `### Giới hạn bản phát hành mới nhất\n\nMục có ngày xuất bản mới nhất trong tài liệu feed đã quan sát chưa có bản khớp chính xác trong catalog. Không thay bằng bài cũ trước BUY/CACHE. Đây là siêu dữ liệu về thứ tự xuất bản; nội dung thay đổi, khả năng tương thích và trạng thái stable/prerelease chưa được xác minh.\n\n${records}\n\nChi phí dịch vụ/model và các khoản đã trả trước đây là những trạng thái riêng.`
      : `### Newest-release limitation\n\nThe newest publication observed in the feed document has no exact catalog item. No older article was substituted before BUY/CACHE. This establishes publication ordering in that snapshot; release changes, compatibility and stable/prerelease status remain unverified.\n\n${records}\n\nService/model costs and earlier payments are separate states.`;
    return remaining.length ? `${report}\n\n${sourceRecencyReport(remaining, vi)}` : report;
  }
  const feeds = [...new Set(gaps.flatMap(gap => gap.feedUrl ? [gap.feedUrl] : []))].slice(0, 8).map(url => `\`${url}\``).join(", ");
  const target = feeds || (vi ? "phạm vi nguồn chưa được xác định" : "the unresolved source scope");
  const held = gaps.some(gap => gap.scope === "catalog");
  const admission = vi
    ? held ? "Các bài catalog bị ảnh hưởng đã bị giữ lại trước khi chọn BUY/CACHE; không thay chúng bằng bài cũ có điểm liên quan cao hơn." : "Chưa có bài catalog phù hợp được xác minh cho yêu cầu này. Các nguồn khác có thể hỗ trợ phần còn lại của câu hỏi."
    : held ? "Affected retained catalog candidates were withheld before BUY/CACHE selection; those candidates were not replaced by older, more relevant articles." : "No qualified matching catalog article is available for this requirement. Other sources may support the rest of the question.";
  return vi
    ? `### Giới hạn bản phát hành mới nhất\n\nChưa thể xác nhận mục mới nhất cho ${target}: tiêu chí, phạm vi hoặc quan sát feed chưa được xác minh phù hợp. ${admission} Yêu cầu xác định mục mới nhất trong phạm vi của người hỏi vẫn chưa được xác minh. Chi phí dịch vụ/model và các khoản đã trả trước đây là những trạng thái riêng.`
    : `### Newest-release limitation\n\nNewest-entry selection for ${target} is unavailable: the criterion, scope or feed observation has not been qualified. ${admission} The caller's newest-entry criterion and scope remain unverified. Service/model costs and earlier payments are separate states.`;
}

/** Validate historical data shape, never restore a live observer/selection capability. */
function hasUnindexedObservedWinner(gap: SourceRecencyGap): boolean {
  return gap.reason === "newest-entry-not-indexed" && !!gap.observation &&
    !!projectSourceRecencyResult({ version: 1, scope: "current-feed", metadataReads: 1, observations: [], gaps: [gap] });
}

function diagnosticText(value: string): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  const points = Array.from(flat), bounded = points.length > 300 ? `${points.slice(0, 300).join("")}…` : flat;
  return bounded.replace(/[\\`*_{}\[\]()<>!#|]/gu, "\\$&");
}

/** Informational post-delivery record; no body/evidence/creator payment eligibility is restored. */
export function sourceRecencyObservationReport(observations: readonly SourceRecencyFeedMetadata[], vi: boolean): string {
  if (!observations.length) return "";
  const recorded = projectSourceRecencyResult({ version: 1, scope: "current-feed", metadataReads: observations.length, observations, gaps: [] });
  if (!recorded) return "";
  const rows = recorded.observations.map(metadata => {
    const entry = metadata.newestEntry;
    return vi
      ? `- ${diagnosticText(metadata.feedUrl)} — quan sát lúc ${metadata.capturedAt}, ${metadata.membershipCount} mục trong tài liệu. Mục có ngày xuất bản mới nhất: ${diagnosticText(entry.title)}, ${diagnosticText(entry.itemUrl)}; ${entry.publication.field}: ${diagnosticText(entry.publication.rawValue)} (${entry.publication.publishedAt}).`
      : `- ${diagnosticText(metadata.feedUrl)} — observed at ${metadata.capturedAt}, ${metadata.membershipCount} document entries. Newest by native publication date: ${diagnosticText(entry.title)}, ${diagnosticText(entry.itemUrl)}; ${entry.publication.field}: ${diagnosticText(entry.publication.rawValue)} (${entry.publication.publishedAt}).`;
  }).join("\n");
  return vi
    ? `### Quan sát feed hiện tại\n\n${rows}\n\nĐây là siêu dữ liệu về thứ tự ngày xuất bản trong tài liệu feed đã đọc. Nội dung thay đổi, khả năng tương thích và trạng thái stable/prerelease chưa được xác minh bằng quan sát này.`
    : `### Current feed snapshot\n\n${rows}\n\nThis records native publication ordering in the retrieved feed document. Release changes, compatibility and stable/prerelease status remain unverified by this observation.`;
}
