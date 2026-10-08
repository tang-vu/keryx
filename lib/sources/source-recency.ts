import { requestedSourceUrls } from "../research/source-requirements";

type RecencyGapReason = "newest-feed-observation-unqualified" | "unsupported-temporal-form" |
  "ambiguous-feed-urls" | "source-binding-unresolved" | "question-scan-limit";

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
  readonly reason: RecencyGapReason;
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

/**
 * Stage one covers these explicit positive instructions at the beginning of the original
 * question. It does not claim general temporal-language understanding or infer ordering,
 * stable/prerelease status, freshness, completeness or an observation from retained rows.
 */
export function recognizeSourceRecency(question: string): SourceRecencyRequirement | null {
  const bounded = question.slice(0, 30000);
  const family = /^\s*(?:please\s+)?(?:name|identify|find|compare)\s+(?:the\s+)?(?:newest|latest)\s+(?:(?:stable|prerelease|non-prerelease)\s+)?(?:releases?|versions?|entries|entry|articles?)\b/iu;
  const viFamily = /^\s*(?:hãy\s+)?(?:nêu|xác định|tìm|so sánh)\s+bản phát hành\s+(?:ổn định\s+)?mới nhất\b/iu;
  if (!family.test(bounded) && !viFamily.test(bounded)) return null;
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
  const unsupportedForm = !match || /\b(?:stable|prerelease|non-prerelease|before|after|cutoff|cached|retained|among|compare)\b|(?:^|[^\p{L}\p{N}])(?:trước|sau|ổn định|đã lưu)(?=$|[^\p{L}\p{N}])/iu.test(bounded);
  const reason: RecencyGapReason = incomplete ? "question-scan-limit" : unresolved ? "source-binding-unresolved"
    : feedUrls.length > 1 ? "ambiguous-feed-urls" : unsupportedForm ? "unsupported-temporal-form" : "newest-feed-observation-unqualified";
  const status = reason === "newest-feed-observation-unqualified" ? "explicit-single-feed" : "unsupported";
  return Object.freeze({ kind: "newest-feed-entry", status, binding: unresolved ? "unresolved" : "exact-feeds",
    feedUrls: Object.freeze(feedUrls), reason,
    originalSpan: Object.freeze({ start: 0, end: status === "unsupported" ? bounded.length : match![0].length }) });
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
