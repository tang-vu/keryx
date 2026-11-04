interface PortugueseTeachingFields {
  durationMinutes: number;
  exampleCount: number;
  explanationMaximumWords: number;
}

const word = String.raw`[\p{L}\p{M}\p{N}_]`;
const counts: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, três: 3, quatro: 4,
  cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15, vinte: 20, trinta: 30 };
function count(value: string): number | undefined {
  return Object.hasOwn(counts, value) ? counts[value] : /^\d+$/u.test(value) ? Number(value) : undefined;
}
function negated(text: string, index: number): boolean {
  const clause = text.slice(Math.max(0, index - 100), index).split(/[.!?;]/u).at(-1) ?? "";
  return /(?<![\p{L}\p{M}\p{N}_])(?:não|nao|nunca|nem|sem)\s+(?:\S+\s+){0,5}$/u.test(clause);
}
function unique(text: string, source: string): RegExpMatchArray | undefined {
  const matches = [...text.matchAll(new RegExp(String.raw`(?<!${word})(?:${source})(?!${word})`, "gu"))];
  return matches.length === 1 && !negated(text, matches[0].index!) ? matches[0] : undefined;
}

/** Finite original-caller Portuguese admission; no source text or model plan. */
export function portugueseTeachingRequest(original: string): { selected: true; fields?: PortugueseTeachingFields } | undefined {
  const text = original.normalize("NFC").toLowerCase()
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`|“[^”]*”|‘[^’]*’|"[^"\r\n]*"|^\s*>.*$/gmu, " ");
  const languages = [...text.matchAll(/(?<![\p{L}\p{M}\p{N}_])(?:(escreva|responda)\s+em\s+([\p{L}\p{M}-]+)|(?:write|answer|respond)\s+in\s+([\p{L}\p{M}-]+)|(?:viết|trả lời|đáp|soạn|trình bày)\s+(?:bằng\s+)?tiếng\s+([\p{L}\p{M}-]+))/gu)];
  if (!languages.some(match => match[1])) return;
  const inactive = { selected: true as const };
  if (languages.length !== 1 || languages[0][2] !== "português" || negated(text, languages[0].index!) ||
      /(?:^|\n)\s*(?:question|constraints|pergunta|fonte|source)\s*:/u.test(text) ||
      /\b(?:fonte|documento|página|artigo|texto)\s+(?:diz|pede|instrui|solicita|manda)\b/u.test(text) ||
      /^\s*(?:explique|analise|avalie|traduza|cite)\s+(?:a\s+)?(?:frase|instrução|pedido)\b/u.test(text)) return inactive;

  // Capture whole count tokens, including unsupported ones, so a second request
  // cannot disappear merely because its count is outside the finite contract.
  const activity = unique(text, String.raw`(\S{1,32})\s+atividades?\s+(?:de|com\s+duração\s+de)\s+(\S{1,32})\s+minutos?`);
  const examples = unique(text, String.raw`((?!(?:os|esses|estes|aqueles|meus|seus)\b)\S{1,32})\s+exemplos?`);
  const exit = unique(text, String.raw`(?:(?:termine|finalize)\s+com\s+(?:uma|1)\s+pergunta\s+e\s+(?:sua|a)\s+resposta|(?:uma|1)\s+pergunta\s+final\s+com\s+(?:a\s+)?resposta)`);
  const explanation = unique(text, String.raw`(?:explique\s+[^.;\n]{0,100}?|explicação\s+(?:(?:com|em)\s+)?)(?:em\s+)?(menos\s+de|no\s+máximo|até)\s+(\S{1,32})\s+palavras`);
  const label = unique(text, String.raw`(?:marque|identifique|rotule)\s+(?:(?:os\s+)?exemplos?\s+e\s+(?:a\s+)?atividade|(?:a\s+)?atividade\s+e\s+(?:os\s+)?exemplos?)\s+como\s+propostas?\s+suas`);
  if (!activity || !examples || !exit || !explanation || !label ||
      !/\b(?:classificarem|classificar|classificação)\b/u.test(text.slice(examples.index! + examples[0].length,
        examples.index! + examples[0].length + 80).split(/[.;\n]/u)[0])) return inactive;
  // Positive historical attribution is incompatible with a prospective lesson.
  if ([...text.matchAll(/\b(?:nasa|fonte|autor|autora)\s+(?:já\s+)?(?:testou|realizou|experimentou)\s+(?:(?:a|essa|esta)\s+)?(?:atividade|aula)\b/gu)]
    .some(match => !negated(text, match.index!)) ||
      [...text.matchAll(/\b(?:atividade|aula)\s+(?:foi\s+)?(?:testada|realizada|experimentada)\s+(?:pela|pelo)\s+(?:nasa|fonte|autor|autora)\b/gu)]
        .some(match => !negated(text, match.index!))) return inactive;
  if (count(activity[1]) !== 1) return inactive;
  const durationMinutes = count(activity[2]), exampleCount = count(examples[1]), maximum = count(explanation[2]);
  if (durationMinutes === undefined || exampleCount === undefined || maximum === undefined) return inactive;
  const explanationMaximumWords = maximum - Number(explanation[1] === "menos de");
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 30 ||
      !Number.isSafeInteger(exampleCount) || exampleCount < 1 || exampleCount > 4 ||
      !Number.isSafeInteger(explanationMaximumWords) || explanationMaximumWords < 1 || explanationMaximumWords > 200) return inactive;
  return { selected: true, fields: { durationMinutes, exampleCount, explanationMaximumWords } };
}
