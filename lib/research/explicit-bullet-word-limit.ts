import { answerWordBudget } from "./answer-word-budget";
import { explicitBulletCount } from "./explicit-bullet-count";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";

/** An additional complete-answer constraint on an explicit EN/VI bullet request.
 * This never changes synthesis, research targets, or the existing single-limit grammar. */
export function explicitBulletWordLimit(question: string, language: PresentationLanguage): number | undefined {
  if (question.length > 30_000 || (language !== "en" && language !== "vi")) return;
  if (explicitBulletCount(question)?.kind !== "recognized") return;
  const text = visibleDirections(question.normalize("NFC").toLowerCase());
  if (explicitBulletCount(text)?.kind !== "recognized") return;
  const units = [...text.matchAll(/(?<![\p{L}\p{N}_])([^\s,;:!?]+)\s+(?:words|từ)(?![\p{L}\p{N}_])/gu)];
  const limits = new Set<number>();
  for (const unit of units) {
    // Non-numeric uses of "từ" (from) are ordinary Vietnamese prose.
    if (!/\d/u.test(unit[1])) continue;
    if (!/^[1-9]\d{0,3}$/u.test(unit[1]) || Number(unit[1]) > 2000) return;
    const before = text.slice(0, unit.index!);
    const standalone = /(?:^|[.!?;\n\r\u2028\u2029])\s*(?:please\s+)?(?:keep\s+(?:the\s+)?(?:note|answer|response)\s+(?:within|at most)|(?:answer|respond)\s+in\s+(?:at most|no more than))\s+$/u.exec(before)
      ?? /(?:^|[.!?;\n\r\u2028\u2029])\s*(?:(?:hãy|xin)\s+)?(?:viết|trả lời|giữ\s+(?:câu|phần)\s+trả lời)\s+(?:tối đa|không quá)\s+$/u.exec(before);
    if (standalone && /(?:do\s+not|don't|never|đừng|không)\s+(?:(?:explicitly|only|chỉ)\s+)?$/u.test(before.slice(0,
      standalone.index + standalone[0].search(/[\p{L}]/u)))) return;
    const inline = /(?:bullets?|bullet\s+points?|gạch\s+đầu\s+dòng)\s*,\s*(?:at\s+most|no\s+more\s+than|tối\s+đa|không\s+quá)\s+$/u.test(before);
    if (!standalone && !inline) return;
    const tail = text.slice(unit.index! + unit[0].length);
    // No region exemptions such as "excluding citations" or "không tính trích dẫn".
    if (!/^\s*(?:$|[.!?;:\n\r\u2028\u2029])/u.test(tail)) return;
    limits.add(Number(unit[1]));
  }
  if (limits.size !== 1) return;
  const maximum = [...limits][0];
  // Keep the established positive English-language eligibility, including an
  // unsupported-language fallback. The appended directive is only a parser probe.
  if (language === "en" && answerWordBudget(`${question}\nKeep the answer within ${maximum} words.`) !== maximum) return;
  return maximum;
}

function visibleDirections(value: string): string {
  const blank = (text: string) => text.replace(/[^\r\n\u2028\u2029]/gu, " ");
  value = value.replace(/^[\t ]*(?:```[^\n]*\n[\s\S]*?(?:^[\t ]*```[^\n]*(?:\n|$)|(?![\s\S]))|~~~[^\n]*\n[\s\S]*?(?:^[\t ]*~~~[^\n]*(?:\n|$)|(?![\s\S]))|>[^\n]*)/gmu, blank);
  const closers: Readonly<Record<string, string>> = { '"': '"', "'": "'", "`": "`", "“": "”", "‘": "’", "«": "»", "「": "」", "『": "』" };
  let closing: string | undefined, visible = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index], apostrophe = char === "'" && /[\p{L}\p{N}]/u.test(value[index - 1] ?? "") && /[\p{L}\p{N}]/u.test(value[index + 1] ?? "");
    if (closing) { visible += blank(char); if (char === closing && !apostrophe) closing = undefined; continue; }
    if (closers[char] && !apostrophe) { closing = closers[char]; visible += " "; continue; }
    visible += char;
  }
  return visible;
}
