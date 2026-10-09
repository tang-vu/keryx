import { researchResponseLanguage } from "../agent/empty-public-evidence";

/** Ordinary research presentation, derived only from the original caller request. */
export interface AnswerPresentation {
  language: "en" | "vi" | "pt";
  requestedLanguage?: "en" | "vi" | "pt";
  requestedBulletCount?: number;
}

const counts: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  um: 1, dois: 2, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  một: 1, hai: 2, ba: 3, bốn: 4, năm: 5, sáu: 6, bảy: 7, tám: 8,
};

function negated(text: string, index: number): boolean {
  return /(?<![\p{L}\p{N}_])(?:do not|don't|not|não|nao|không|no|nunca|sin|pas|sans|nicht)\s+(?:[^\s.,;:!?]+\s+){0,2}$/u.test(text.slice(Math.max(0, index - 45), index));
}

/** Finite positive language/count instructions; ambiguous counts retain target layout. */
export function answerPresentation(question: string): AnswerPresentation {
  const text = question.slice(0, 30_000).normalize("NFC").toLowerCase();
  const explicit = /(?<![\p{L}\p{N}_])(?:(?:answer|respond|reply|write)\s+(?:only\s+)?(?:in|using)\s+((?:brazilian\s+)?portuguese|[\p{L}-]+)|(?:trả lời|viết|đáp)\s+(?:bằng\s+)?tiếng\s+(bồ đào nha|[\p{L}-]+)|(?:responda em|escreva em)\s+(português(?:\s+(?:brasileiro|do brasil))?|[\p{L}-]+)|em\s+(português(?:\s+(?:brasileiro|do brasil))?|inglês|vietnamita|francês|espanhol|alemão|japonês|chinês)|(?:responda|responde|escriba|escribe)\s+(?:solo\s+)?en\s+(español)|en\s+(español|français)(?=\s*[,;:])|(?:antworte\s+(?:bitte\s+)?)?auf\s+(deutsch))(?![\p{L}\p{N}_])/gu;
  const requests = [...text.matchAll(explicit)];
  // Cue detection must not treat a negated language directive as a positive request.
  const cues = text.replace(explicit, " ");
  let language: AnswerPresentation["language"] = researchResponseLanguage(cues);
  // "explique", "responda", "sobre" and "para" are also Spanish cues.
  if (/\b(?:sou|preciso|escreva)\b/u.test(cues) &&
      /\b(?:uma|para|sobre|entre)\b/u.test(cues)) language = "pt";
  let requestedLanguage: AnswerPresentation["requestedLanguage"];
  for (const request of requests) {
    if (negated(text, request.index!)) continue;
    // New native forms are directives only at a clause boundary, not page titles
    // or quoted language mentions inside the caller's substantive question.
    if (request.slice(5).some(value => value !== undefined) &&
        !/(?:^|[.!?;:\r\n])\s*$/u.test(text.slice(0, request.index!))) continue;
    const name = request.slice(1).find(value => value !== undefined)!;
    requestedLanguage = /^(?:vietnamese|việt|vietnamita)$/u.test(name) ? "vi"
      : /^(?:(?:brazilian )?portuguese|português(?: brasileiro| do brasil)?|bồ đào nha)$/u.test(name) ? "pt"
      : /^(?:english|anh|inglês)$/u.test(name) ? "en" : undefined;
    // Unsupported requests use neutral labels without forcing statement translation.
    language = requestedLanguage ?? "en";
  }
  const numbers = Object.keys(counts).join("|");
  const pattern = new RegExp(`\\b([1-8]|${numbers})\\s+(?:(?:short|brief|concise|curtos?|breves?|ngắn)\\s+)?(?:bullets?|bullet points?|tópicos?|pontos?|gạch đầu dòng)(?:\\s+(?:curtos?|breves?|ngắn))?(?=$|[\\s.,;:!?])`, "gu");
  const requested = new Set<number>();
  for (const match of text.matchAll(pattern)) {
    if (negated(text, match.index!)) continue;
    // Compact rendering is deliberately limited to explicitly short bullet requests.
    const vicinity = text.slice(Math.max(0, match.index! - 16), match.index! + match[0].length);
    if (!/\b(?:short|brief|concise|curtos?|breves?)\b|ngắn/u.test(vicinity)) continue;
    requested.add(counts[match[1]] ?? Number(match[1]));
  }
  return { language, ...(requestedLanguage ? { requestedLanguage } : {}),
    ...(requested.size === 1 ? { requestedBulletCount: [...requested][0] } : {}) };
}

/** Translate at generation time, before separate statement review; never after it. */
export function presentationStatementGuidance(presentation: AnswerPresentation): string {
  // An English label fallback does not authorize overriding an unsupported language request.
  if (!presentation.requestedLanguage) return "";
  const language = { en: "English", vi: "Vietnamese", pt: "Brazilian Portuguese" }[presentation.requestedLanguage];
  return `For this ordinary research answer, write each statement in ${language}. The original caller's explicit output language takes precedence over the question's language. `;
}
