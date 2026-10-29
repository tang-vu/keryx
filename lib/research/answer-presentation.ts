import { researchResponseLanguage } from "../agent/empty-public-evidence";
import { answerWordBudget } from "./answer-word-budget";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";
import { chineseAnswerInstructions } from "./chinese-answer-intent";

/** Ordinary research presentation, derived only from the original caller request. */
export interface AnswerPresentation {
  language: PresentationLanguage;
  requestedLanguage?: PresentationLanguage;
  requestedBulletCount?: number;
  /** Exact note-prose count; inspectable originals and mandatory notices are separate. */
  requestedSentenceCount?: number;
  requestedMaximumWords?: number;
}

const counts: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  um: 1, dois: 2, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  một: 1, hai: 2, ba: 3, bốn: 4, năm: 5, sáu: 6, bảy: 7, tám: 8,
};

function negated(text: string, index: number, ordinary = false): boolean {
  const prefix = text.slice(Math.max(0, index - 45), index);
  const line = prefix.split(/[\r\n\u2028\u2029]/u).at(-1)!;
  if (ordinary && /(?<![\p{L}\p{N}_])ne\s+(?:(?:seulement|uniquement|exactement|explicitement)\s+){0,2}$/u.test(prefix)) return true;
  if (/(?<![\p{L}\p{N}_])(?:do not|don't|not|não|nao|không|no|nunca|sin|pas|sans|nicht)\s+(?:[^\s.,;:!?]+\s+){0,2}$/u.test(line)) return true;
  // Preserve finite explicit command wrappers across lines. Discourse such as
  // "No thanks\n", "Não obrigado\n" or "Không cảm ơn\n" starts a new clause.
  return /(?<![\p{L}\p{N}_])(?:do not|don't)\s+(?:[^\s.,;:!?]+\s+){0,2}$/u.test(prefix)
    || /(?<![\p{L}\p{N}_])(?:não|nao)\s+(?:(?:apenas|só|somente|exatamente|explicitamente)\s+){0,2}(?:(?:responda|responde|escreva|escreve)\s+(?:(?:apenas|só|somente|exatamente|explicitamente)\s+){0,2})?$/u.test(prefix)
    || /(?<![\p{L}\p{N}_])không\s+(?:(?:chỉ|đúng|chính xác)\s+){0,2}(?:(?:viết|trả lời|đáp)\s+(?:(?:chỉ|đúng|chính xác)\s+){0,2})?$/u.test(prefix)
    || /(?<![\p{L}\p{N}_])(?:no|nunca|sin|pas|sans|nicht)\s+(?:(?:solo|solamente|únicamente|seulement|uniquement|nur|bitte)\s+){0,2}$/u.test(prefix);
}

/** Finite positive language/count instructions; ambiguous counts retain target layout. */
export function answerPresentation(question: string, scope: "ordinary" | "retained" | "legacy" = "ordinary"): AnswerPresentation {
  const text = question.slice(0, 30_000).normalize("NFC").toLowerCase();
  const explicit = /(?<![\p{L}\p{N}_])(?:(?:answer|respond|reply|write)\s+(?:only\s+)?(?:in|using)\s+((?:brazilian\s+)?portuguese|[\p{L}-]+)|(?:trả lời|viết|đáp)\s+(?:bằng\s+)?tiếng\s+(bồ đào nha|[\p{L}-]+)|(?:responda em|escreva em)\s+(português(?:\s+(?:brasileiro|do brasil))?|[\p{L}-]+)|em\s+(português(?:\s+(?:brasileiro|do brasil))?|inglês|vietnamita|francês|espanhol|alemão|japonês|chinês)|(?:responda|responde|escriba|escribe)\s+(?:solo\s+)?en\s+(español)|en\s+(español|français)(?=\s*[,;:])|(?:antworte\s+(?:bitte\s+)?)?auf\s+(deutsch)|(?:réponds?|répondez|répondre|écris|écrivez)\s+(?:uniquement\s+)?en\s+(français)|in\s+(english)(?=\s*[,;:]))(?![\p{L}\p{N}_])/gu;
  const chinese = scope === "ordinary" ? chineseAnswerInstructions(text) : [];
  const requests = [
    ...[...text.matchAll(explicit)].filter(match => !chinese.some(span => match.index! >= span.index && match.index! < span.end))
      .map(match => ({ kind: "existing" as const, index: match.index!, match })),
    ...chinese.filter(instruction => instruction.eligible)
      .map(instruction => ({ kind: "chinese" as const, index: instruction.index, instruction })),
  ].sort((left, right) => left.index - right.index);
  const quotedRanges = [...text.matchAll(/"[^"]*"|“[^”]*”|«[^»]*»|`[^`]*`|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu)]
    .map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  // Cue detection must not treat a negated language directive as a positive request.
  const cues = text.replace(explicit, " ");
  let language: AnswerPresentation["language"] = researchResponseLanguage(cues);
  // Shared Spanish verbs need the distinctive Portuguese "uma" cue.
  if ((/\b(?:sou|escreva)\b/u.test(cues) && /\b(?:uma|para|sobre|entre)\b/u.test(cues)) ||
      (/\b(?:preciso|explique|responda)\b/u.test(cues) && /\buma\b/u.test(cues))) language = "pt";
  let requestedLanguage: AnswerPresentation["requestedLanguage"];
  let budgetLanguageDirective: { index: number; english: boolean } | undefined;
  for (const entry of requests) {
    if (entry.kind === "chinese") {
      requestedLanguage = entry.instruction.language;
      language = requestedLanguage ?? "en";
      budgetLanguageDirective = { index: entry.index, english: requestedLanguage === "en" };
      continue;
    }
    const request = entry.match;
    if (negated(text, request.index!, scope === "ordinary")) continue;
    // The ordinary English shorthand resolves a later French/English instruction.
    // Retained originals keep their previous finite directive grammar.
    if (scope !== "ordinary" && (request[8] !== undefined || request[9] !== undefined)) continue;
    // New native forms are directives only at a clause boundary, not page titles
    // or quoted language mentions inside the caller's substantive question.
    const boundary = scope === "ordinary" ? /(?:^|[.!?;:。！？；：\r\n\u2028\u2029])\s*$/u : /(?:^|[.!?;:\r\n\u2028\u2029])\s*$/u;
    if (request.slice(5).some(value => value !== undefined) &&
        (!boundary.test(text.slice(0, request.index!)) ||
         quotedRanges.some(range => request.index! >= range.start && request.index! < range.end))) continue;
    const name = request.slice(1).find(value => value !== undefined)!;
    // Newly supported French directives inside quoted examples are original data.
    if (scope === "ordinary" && /^(?:french|français|francês|pháp)$/u.test(name) &&
        quotedRanges.some(range => request.index! >= range.start && request.index! < range.end)) continue;
    // Budget eligibility observes the existing finite directive grammar, without
    // changing statement-language selection or treating a neutral fallback as English.
    const numericWordLimit = /^(?:answer|respond)\s+in\s+(?:at most|no more than)\s+[1-9]\d{0,3}\s+words\b/u.test(text.slice(request.index!));
    // A numeric length constraint is not a new output-language instruction.
    if (numericWordLimit && scope === "ordinary") continue;
    if (!numericWordLimit && !quotedRanges.some(range => request.index! >= range.start && request.index! < range.end))
      budgetLanguageDirective = { index: request.index!, english: /^(?:english|anh|inglês)$/u.test(name) };
    requestedLanguage = /^(?:vietnamese|việt|vietnamita)$/u.test(name) ? "vi"
      : /^(?:(?:brazilian )?portuguese|português(?: brasileiro| do brasil)?|bồ đào nha)$/u.test(name) ? "pt"
      : scope !== "retained" && /^(?:spanish|español|espanhol)$/u.test(name) ? "es"
      : scope === "ordinary" && /^(?:french|français|francês|pháp)$/u.test(name) ? "fr"
      : /^(?:english|anh|inglês)$/u.test(name) ? "en" : undefined;
    // Unsupported requests use neutral labels without forcing statement translation.
    language = requestedLanguage ?? "en";
  }
  const numbers = Object.keys(counts).join("|");
  const pattern = new RegExp(`\\b([1-8]|${numbers})\\s+(?:(?:short|brief|concise|curtos?|breves?|ngắn)\\s+)?(?:bullets?|bullet points?|tópicos?|pontos?|gạch đầu dòng)(?:\\s+(?:curtos?|breves?|ngắn))?(?=$|[\\s.,;:!?])`, "gu");
  const requested = new Set<number>();
  for (const match of text.matchAll(pattern)) {
    if (negated(text, match.index!, scope === "ordinary")) continue;
    // Compact rendering is deliberately limited to explicitly short bullet requests.
    const vicinity = text.slice(Math.max(0, match.index! - 16), match.index! + match[0].length);
    if (!/\b(?:short|brief|concise|curtos?|breves?)\b|ngắn/u.test(vicinity)) continue;
    requested.add(counts[match[1]] ?? Number(match[1]));
  }
  const maximumWords = scope !== "retained" && language === "en" && !requested.size
    ? answerWordBudget(question, budgetLanguageDirective) : undefined;
  const sentenceCounts: Record<string, number> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 };
  const sentences = new Set<number>();
  const sentenceInstruction = /(?<![\p{L}\p{N}_])(?:escriba|escribe)\s+(?:una\s+)?(?:nota|respuesta)\s+breve\s+de\s+([\p{L}\d]+)\s+(?:frases?|oración|oraciones)(?=\s*(?:$|[.!?;:\r\n\u2028\u2029]))/gu;
  if (scope !== "retained" && language === "es" && !requested.size) {
    for (const match of text.matchAll(sentenceInstruction)) {
      if (negated(text, match.index!, scope === "ordinary") || quotedRanges.some(range => match.index! >= range.start && match.index! < range.end)) continue;
      // A quoted example or an embedded discussion of instructions is not a command.
      if (!/(?:^|[.!?;:\r\n\u2028\u2029])\s*(?:en español\s*,\s*)?$/u.test(text.slice(0, match.index!))) continue;
      // An unsupported second count is ambiguity, not permission to retain the first.
      sentences.add(sentenceCounts[match[1]] ?? Number(match[1]));
    }
  }
  return { language, ...(requestedLanguage ? { requestedLanguage } : {}),
    ...(requested.size === 1 ? { requestedBulletCount: [...requested][0] } : {}),
    ...(sentences.size === 1 && Number.isInteger([...sentences][0]) && [...sentences][0] >= 1 && [...sentences][0] <= 8
      ? { requestedSentenceCount: [...sentences][0] } : {}),
    ...(maximumWords ? { requestedMaximumWords: maximumWords } : {}) };
}

/** Translate at generation time, before separate statement review; never after it. */
export function presentationStatementGuidance(presentation: AnswerPresentation): string {
  // An English label fallback does not authorize overriding an unsupported language request.
  if (!presentation.requestedLanguage) return "";
  const language = { en: "English", vi: "Vietnamese", pt: "Brazilian Portuguese", es: "Spanish", fr: "French", "zh-Hans": "Simplified Chinese" }[presentation.requestedLanguage];
  const count = presentation.requestedSentenceCount;
  const note = presentation.language === "es" && Number.isInteger(count) && count! >= 1 && count! <= 8
    ? `The caller requests a short note of exactly ${count} sentences, with inspectable originals separately. ` +
      `Generate the smallest sufficient set of exactly ${count} single-sentence statement/quote pairs ONLY if that set fully covers every research target and preserves all qualifications. ` +
      "One statement may use one offered contiguous adjacent-sentence quote, but never infer across separate quotes. " +
      "Keep each original research target's claimIndex. If safe complete coverage cannot fit that count, retain the useful supported pairs and leave missing parts explicit; never omit a fact or qualification, invent padding, or force the format. "
    : "";
  return `For this ordinary research answer, write each statement in ${language}. The original caller's explicit output language takes precedence over the question's language. ` + note;
}
