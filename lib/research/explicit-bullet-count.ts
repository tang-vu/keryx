import { WORK_PRODUCT_REQUEST, WORK_PRODUCT_DELIVERABLE, WORK_PRODUCT_CRITERIA } from "./work-product-intent";

export type ExplicitBulletCount = { kind: "recognized"; count: number; mode: "exact" | "maximum" } | { kind: "refused" };

const numbers: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, một: 1, hai: 2, ba: 3, bốn: 4, năm: 5, sáu: 6, bảy: 7, tám: 8, chín: 9, mười: 10 };
const limit = /(?<![\p{L}\p{N}_])(exactly|at\s+most|no\s+more\s+than|đúng|chính\s+xác|tối\s+đa|không\s+quá)\s+([\p{L}\d]+)\s+(?:(?:short|brief|concise|ngắn)\s+)?(?:bullets?|bullet\s+points?|gạch\s+đầu\s+dòng)(?![\p{L}\p{N}_])/gu;
const unit = new RegExp(`(?<![\\p{L}\\p{N}_])(\\d+|${Object.keys(numbers).join("|")})\\s+(?:(?:short|brief|concise|ngắn)\\s+)?(?:bullets?|bullet\\s+points?|gạch\\s+đầu\\s+dòng)(?![\\p{L}\\p{N}_])`, "gu");

/** Finite original caller directions for the final projection. Refusal never
 * selects this new format; older presentation contracts remain separate. */
export function explicitBulletCount(question: string): ExplicitBulletCount | undefined {
  const original = question.slice(0, 30_000).normalize("NFC").toLowerCase();
  if (!original.match(limit)) return;
  const refused = { kind: "refused" as const };
  if (question.length > 30_000) return refused;
  if ([WORK_PRODUCT_REQUEST, WORK_PRODUCT_DELIVERABLE, WORK_PRODUCT_CRITERIA].some(marker => question.includes(marker)) ||
      /(?:^|\n)\s*(?:Question|Constraints|Unread source leads):/u.test(question)) return refused;
  const visible = withoutQuotedText(original);
  // Source/example envelopes are data. Their wording never supplies the format.
  if (/(?:^|[\n.!?])\s*(?:(?:the|our|this)\s+)?(?:source|document|article|transcript|example|nguồn|tài liệu|trích đoạn|ví dụ)\s*(?:says|text|excerpt|content|quote|instructions|nói|ghi|:|：)/u.test(visible)) return refused;
  const matches = [...visible.matchAll(limit)];
  if (!matches.length || matches.length > 16) return refused;
  const choices: Array<{ count: number; mode: "exact" | "maximum" }> = [];
  for (const match of matches) {
    const before = visible.slice(Math.max(0, match.index! - 180), match.index!);
    const directive = /(?:^|[.!?;:,\n]\s*)(?:(?:please|hãy|xin)\s+)?(?:write|answer|respond|reply|explain|summarize|provide|give|present|viết|trả\s+lời|giải\s+thích|tóm\s+tắt|trình\s+bày|đưa|cho)\s+[^.!?;\n]{0,120}$/u.exec(before);
    if (!directive || /(?<![\p{L}\p{N}_])(?:do\s+not|don't|not|never|avoid|đừng|không)(?![\p{L}\p{N}_])/u.test(directive[0])) return refused;
    if (/\b(?:why|whether|meaning|means|says|said|asks|example|quoted)\b|tại sao|vì sao|ví dụ/u.test(directive[0])) return refused;
    const count = numbers[match[2]] ?? Number(match[2]);
    if (!Number.isInteger(count) || count < 1 || count > 8) return refused;
    choices.push({ count, mode: /^(?:exactly|đúng|chính\s+xác)$/u.test(match[1]) ? "exact" : "maximum" });
  }
  // A separate unqualified count is a second request, not permission to weaken
  // exact to maximum, or ignore another count. Quoted counts remain data.
  if ([...visible.matchAll(unit)].some(match => !matches.some(span =>
    match.index! >= span.index! && match.index! + match[0].length <= span.index! + span[0].length))) return refused;
  if (new Set(choices.map(choice => `${choice.mode}:${choice.count}`)).size !== 1) return refused;
  return { kind: "recognized", ...choices[0] };
}

function withoutQuotedText(value: string): string {
  const closers: Readonly<Record<string, string>> = { '"': '"', "'": "'", "`": "`", "“": "”", "‘": "’", "«": "»", "「": "」", "『": "』" };
  let closing: string | undefined, visible = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index], internalApostrophe = char === "'" &&
      /[\p{L}\p{N}]/u.test(value[index - 1] ?? "") && /[\p{L}\p{N}]/u.test(value[index + 1] ?? "");
    if (closing) { visible += char === "\n" ? "\n" : " "; if (char === closing && !internalApostrophe) closing = undefined; continue; }
    if (closers[char] && !internalApostrophe) { closing = closers[char]; visible += " "; continue; }
    visible += char;
  }
  return visible;
}
