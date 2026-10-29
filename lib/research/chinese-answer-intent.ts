/** Additional ordinary-answer directives only. This is not a language detector. */
export interface ChineseAnswerInstruction {
  index: number;
  end: number;
  language: "zh-Hans" | "en" | undefined;
  eligible: boolean;
}

/** Keep all recognized spans so the ordinary parser can exclude a partial old
 * English match even when the complete new instruction is quoted or negated.
 * Retained/legacy callers must not invoke this additional grammar. */
export function chineseAnswerInstructions(text: string): ChineseAnswerInstruction[] {
  const quoted = [...text.matchAll(/"[^"]*"|“[^”]*”|«[^»]*»|「[^」]*」|『[^』]*』|《[^》]*》|`[^`]*`|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu)]
    .map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  const pattern = /(?<![\p{L}\p{N}_])(?:please\s+)?(?:answer|respond|reply|write)\s+(?:only\s+)?(?:in|using)\s+(simplified\s+chinese|traditional\s+chinese|chinese)(?![\p{L}\p{N}_])|(?:请|請)?\s*(?:用|使用|以)\s*(简体中文|簡體中文|中文|汉语|漢語|英语|英文|繁体中文|繁體中文|正體中文)\s*(?:回答|作答|回复|回覆)/gu;
  return [...text.matchAll(pattern)].map(match => {
    const index = match.index!, prefix = text.slice(0, index);
    const clause = prefix.split(/[.!?;:。！？；：\r\n\u2028\u2029]/u).at(-1)!;
    const name = (match[1] ?? match[2]).replace(/\s+/gu, " ");
    const negative = /(?:do not|don't|不要|别|別|勿|不用|不必|无需|無需)\s*(?:(?:please|请|請|only)\s*)?$/u.test(prefix.slice(-60));
    const inQuote = quoted.some(range => index >= range.start && index < range.end);
    return { index, end: index + match[0].length,
      language: /^(?:simplified chinese|chinese|简体中文|簡體中文|中文|汉语|漢語)$/u.test(name) ? "zh-Hans"
        : /^(?:英语|英文)$/u.test(name) ? "en" : undefined,
      eligible: !negative && !inQuote && /^\s*$/u.test(clause) };
  });
}
