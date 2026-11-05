import { createHash } from "node:crypto";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { parseTeachingProposalRequest } from "./teaching-proposals-request";

export interface AnswerTableRequest { version: 1; questionSha256: string }

/** Only the unchanged caller can request this format. Recognition is deliberately
 * finite; the independent layout review still receives the entire question. */
export function parseAnswerTableRequest(question: string): AnswerTableRequest | undefined {
  if (!question.trim() || question.length > 2_000 || !isWellFormedUtf16(question)) return;
  if (parseTeachingProposalRequest(question)) return;
  // URL punctuation must not split a caller's own instruction. The original
  // question, including exact URLs/versions, remains the digest/review input.
  const visible = visibleDirections(question).replace(/https?:\/\/[^\s]+/giu, url => ` source ${/[,;.!?]+$/u.exec(url)?.[0] ?? ""}`);
  if (/(?:^|[\r\n])\s*(?:Question|Constraints|Unread source leads|Source|Document|Article|Transcript|Nguồn|Tài liệu)\s*[:：]/iu.test(visible) ||
      /\b(?:classroom|lesson|exit question|classification exercise|workshop)\b|\b(?:activities|activity|exercises?)\b[^.!?]{0,60}\b(?:students|pupils|class)\b|giáo án|hoạt động (?:lớp học|trên lớp)|bài tập/iu.test(visible)) return;
  // A table must not silently supersede an independently bounded answer.
  if (/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[-–—]?\s*(?:words?|sentences?|bullets?)\b|(?:\d+|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s+(?:từ|câu|gạch đầu dòng)(?![\p{L}\p{N}_])/iu.test(visible)) return;
  if (/\b(?:not|don't|never|without|no)\b[^.!?;]{0,100}\btables?\b|(?:đừng|không)[^.!?;]{0,100}\bbảng(?![\p{L}\p{N}_])/iu.test(visible)) return;
  const requested = /(?:^|[.!?;\r\n])\s*(?:(?:using|based on)\s+[^.!?;\r\n]{1,150},\s*)?(?:(?:please|can you|could you|would you)\s+)?(?:give|create|make|prepare|draft|write|produce|include|provide|show|return)\b[^.!?;\r\n]{0,130}\btable\b/iu.test(visible) ||
    /(?:^|[.!?;\r\n])\s*(?:please\s+)?use\s+[^.!?;\r\n]{1,120}\s+to\s+(?:write|create|make|produce|prepare)\s+[^.!?;\r\n]{0,80}\btable\b/iu.test(visible) ||
    /(?:^|[.!?;\r\n])\s*(?:please\s+)?use\s+(?:a\s+)?(?:(?:compact|small|short|comparison|decision)\s+)?table\s*(?:[.!?;\r\n]|$|to\s+(?:show|present|compare|summarize|explain)\b)/iu.test(visible) ||
    /(?:^|[.!?;\r\n])\s*(?:I|we)\s+(?:need|want|would like)\b[^.!?;\r\n]{0,100}\btable\b/iu.test(visible) ||
    /(?:^|[.!?;\r\n])\s*(?:(?:xin|hãy)\s+)?(?:tạo|lập|viết|đưa|cho|cung cấp|trình bày)\s+[^.!?;\r\n]{0,100}?bảng(?![\p{L}\p{N}_])/iu.test(visible);
  return requested ? { version: 1, questionSha256: createHash("sha256").update(question).digest("hex") } : undefined;
}

export function validAnswerTableRequest(value: AnswerTableRequest, question: string): boolean {
  return !!value && JSON.stringify(value) === JSON.stringify(parseAnswerTableRequest(question));
}

function visibleDirections(text: string): string {
  const blank = (value: string) => value.replace(/[^\r\n]/gu, " ");
  text = text.replace(/^\s*(?:```[^\n]*\n[\s\S]*?(?:^\s*```[^\n]*(?:\n|$)|(?![\s\S]))|~~~[^\n]*\n[\s\S]*?(?:^\s*~~~[^\n]*(?:\n|$)|(?![\s\S]))|>[^\n]*)/gmu, blank);
  const closers: Record<string, string> = { '"': '"', "'": "'", "`": "`", "“": "”", "‘": "’", "«": "»", "「": "」", "『": "』" };
  let closing: string | undefined, result = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index], apostrophe = char === "'" && /[\p{L}\p{N}]/u.test(text[index - 1] ?? "") && /[\p{L}\p{N}]/u.test(text[index + 1] ?? "");
    if (closing) { result += blank(char); if (char === closing && !apostrophe && text[index - 1] !== "\\") closing = undefined; }
    else if (closers[char] && !apostrophe) { closing = closers[char]; result += " "; }
    else result += char;
  }
  return result;
}
