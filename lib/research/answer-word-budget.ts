/** A finite caller instruction, never a number inferred from a research target. */
export function answerWordBudget(question: string, lastLanguageDirective?: { index: number; english: boolean }): number | undefined {
  const text = question.slice(0, 30_000).normalize("NFC").toLowerCase();
  const quoted = [...text.matchAll(/"[^"]*"|“[^”]*”|«[^»]*»|`[^`]*`|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu)]
    .map(match => [match.index!, match.index! + match[0].length]);
  const inert = (index: number) => {
    const prefix = text.slice(Math.max(0, index - 45), index);
    const line = prefix.split(/[\r\n\u2028\u2029]/u).at(-1)!;
    return quoted.some(([left, right]) => index >= left && index < right) ||
      /(?<![\p{L}\p{N}_])(?:do not|don't|not)\s+(?:[^\s.,;:!?]+\s+){0,2}$/u.test(line) ||
      /(?<![\p{L}\p{N}_])(?:do not|don't)\s+(?:[^\s.,;:!?]+\s+){0,2}$/u.test(prefix);
  };
  // A neutral English scaffold fallback is not an English-language instruction.
  // Keep this eligibility check separate from statement translation/language selection.
  let explicitLanguage = lastLanguageDirective ? lastLanguageDirective.english ? "english" : "unsupported" : undefined;
  let languageIndex = lastLanguageDirective?.index ?? -1;
  const languages = /(?<![\p{L}\p{N}_])(?:answer|respond|reply|write)\s+(?:only\s+)?(?:in|using)\s+(?!(?:at|no)\b)([\p{L}-]+)|(?:^|[.!?;\r\n\u2028\u2029])\s*(?:in\s+([\p{L}-]+)\s*[,;:]|en\s+(français)\s*[,;:]|(?:antworte\s+(?:bitte\s+)?)?auf\s+(deutsch)\b)/gu;
  for (const match of text.matchAll(languages)) {
    const index = match.index! + match[0].search(/[\p{L}]/u);
    if (index >= languageIndex && !inert(index)) {
      explicitLanguage = match.slice(1).find(value => value !== undefined);
      languageIndex = index;
    }
  }
  if (explicitLanguage !== undefined && explicitLanguage !== "english") return undefined;
  const limits = new Set<number>();
  const pattern = /(?:^|[.!?;\r\n\u2028\u2029]["”»`']?)\s*(?:please\s+)?(?:keep\s+(?:the\s+)?(?:note|answer|response)\s+(?:within|at most)|(?:answer|respond)\s+in\s+(?:at most|no more than))\s+([1-9]\d{0,3})\s+words\b/gu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index! + match[0].search(/\b(?:please|keep|answer|respond)\b/u);
    if (inert(start)) continue;
    const tail = text.slice(match.index! + match[0].length).split(/[.!?;\r\n\u2028\u2029]/u)[0];
    // This contract counts everything: partial-region/exemption requests are unsupported.
    if (tail.trim() || Number(match[1]) > 2000) return undefined;
    limits.add(Number(match[1]));
  }
  return limits.size === 1 ? [...limits][0] : undefined;
}

/** Matches the retained-deliverable rubric, including every warning and suffix. */
export function completeAnswerWords(answer: string): number {
  return answer.match(/\S+/gu)?.length ?? 0;
}
