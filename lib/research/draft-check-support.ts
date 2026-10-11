/** Deterministic lexical comparison of one claim with supplied source text.
 * This is not semantic entailment: it reports which verbatim source passage shares
 * the claim's wording, and withholds "supported" when numbers, negation, a listed
 * opposite term or tentative wording differ. Every excerpt is an exact slice of the
 * supplied text. Word order, paraphrase and meaning are not analysed. */

export const DRAFT_CHECK_METHOD = "lexical-overlap-v1" as const;
export const MAX_DRAFT_EXCERPT_CHARACTERS = 600;
export type LexicalVerdict = "supported" | "partly-supported" | "not-found";
export type LexicalDifference = "negation" | "opposite-term" | "different-number";
export interface DraftExcerptSpan { text: string; start: number; end: number }
export interface LexicalSupport {
  verdict: LexicalVerdict;
  /** Present for supported and partly-supported verdicts only. */
  excerpt?: DraftExcerptSpan;
  /** Claim wording absent from the excerpt, or from the whole supplied text when nothing was found. */
  missingTerms: string[];
  missingNumbers: string[];
  /** The excerpt is tentative ("may", "suggest", "unknown") where the claim is not. */
  sourceTentative?: true;
  /** A near passage that was not counted as support, and why. */
  closest?: DraftExcerptSpan & { difference: LexicalDifference };
}

const STOPWORDS = new Set(("a an the and or but if then than that this these those there here of in on at by for with from to into onto over under about "
  + "as is are was were be been being am do does did done has have had having it its they them their we our us you your he she his her i me my "
  + "which who whom whose what when where why how also such can could may might must shall should will would both each either any some all most many much "
  + "very only just so too not no nor never none neither cannot without between among across during after before while per via within "
  + "et al e g i e fig eq vs cf").split(" "));
const NEGATION = /\b(?:not|no|never|none|neither|nor|cannot|without|lacks?|lacked|lacking|absence|fail(?:s|ed|ing)?\s+to|unable)\b|n['’]t\b/u;
const TENTATIVE = /\b(?:may|might|could|possibly|perhaps|whether|unknown|unclear|uncertain|hypothesi[sz]e[sd]?|speculate[sd]?|suggest(?:s|ed)?|appears?\s+to|preliminary)\b/u;
const OPPOSITES: ReadonlyArray<readonly [string, string]> = ([
  ["increase", "decrease"], ["increase", "reduce"], ["rise", "fall"], ["rise", "decline"], ["grow", "shrink"], ["higher", "lower"], ["high", "low"],
  ["more", "fewer"], ["more", "less"], ["greater", "smaller"], ["larger", "smaller"], ["improve", "worsen"], ["improve", "degrade"], ["gain", "loss"],
  ["positive", "negative"], ["above", "below"], ["majority", "minority"], ["faster", "slower"], ["better", "worse"], ["best", "worst"],
  ["significant", "insignificant"], ["significant", "nonsignificant"], ["effective", "ineffective"], ["accept", "reject"], ["safe", "unsafe"],
  ["outperform", "underperform"], ["maximum", "minimum"], ["strengthen", "weaken"], ["present", "absent"], ["success", "failure"],
] as const).map(([left, right]) => [stem(left), stem(right)] as const);
/** Scripts written without word spacing cannot be compared by this word-level method. */
const UNSEGMENTED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

export const usesUnsegmentedScript = (text: string) => UNSEGMENTED.test(text);

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Light English suffix folding so inflected forms of one word compare equal. */
function stem(word: string): string {
  let value = word;
  if (value.length > 4 && (value.endsWith("ies") || value.endsWith("ied"))) value = `${value.slice(0, -3)}y`;
  else if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) value = value.slice(0, -1);
  if (value.length > 5 && value.endsWith("ing")) value = value.slice(0, -3);
  else if (value.length > 3 && value.endsWith("ed")) value = value.slice(0, -1);
  if (value.length > 3 && value.endsWith("e")) value = value.slice(0, -1);
  return value;
}

interface Terms { words: Map<string, string>; counts: Map<string, number>; numbers: Set<string>; negated: boolean; tentative: boolean }

function terms(text: string): Terms {
  const folded = fold(text), words = new Map<string, string>(), counts = new Map<string, number>(), numbers = new Set<string>();
  for (const match of folded.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) numbers.add(match[0].replace(/,/g, ""));
  const spaced = folded.replace(/%/g, " percent ").replace(/n['’]t\b/gu, " ").replace(/['’]s\b/gu, " ");
  for (const match of spaced.matchAll(/\p{L}+/gu)) {
    const word = match[0];
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    const key = stem(word);
    if (!words.has(key)) words.set(key, word);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { words, counts, numbers, negated: NEGATION.test(folded), tentative: TENTATIVE.test(folded) };
}

interface Candidate { start: number; end: number; terms: Terms; sentences: number }

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** Single sentences and adjacent pairs, as exact offsets into the supplied text. */
function candidates(source: string): Candidate[] {
  // Same-length boundary view: line wraps must not end a sentence. Excerpts slice the original.
  const view = source.replace(/[\r\n]/g, " "), singles: Candidate[] = [];
  for (const sentence of segmenter.segment(view)) {
    const body = sentence.segment, start = sentence.index + body.length - body.trimStart().length, end = sentence.index + body.trimEnd().length;
    if (end - start < 8 || end - start > MAX_DRAFT_EXCERPT_CHARACTERS) continue;
    singles.push({ start, end, terms: terms(source.slice(start, end)), sentences: 1 });
  }
  const pairs: Candidate[] = [];
  for (let index = 0; index + 1 < singles.length; index++) {
    const first = singles[index], second = singles[index + 1];
    if (second.end - first.start > MAX_DRAFT_EXCERPT_CHARACTERS || source.slice(first.end, second.start).trim()) continue;
    pairs.push({ start: first.start, end: second.end, terms: terms(source.slice(first.start, second.end)), sentences: 2 });
  }
  return [...singles, ...pairs];
}

export interface PreparedSource { text: string; candidates: Candidate[]; vocabulary: Terms }
export const prepareDraftSource = (text: string): PreparedSource => ({ text, candidates: candidates(text), vocabulary: terms(text) });

/** The claim uses one word of a listed pair more often than the passage, which uses the other more often. */
function oppositeTerm(claim: Terms, passage: Terms): boolean {
  const surplus = (from: Terms, against: Terms, key: string) => (from.counts.get(key) ?? 0) > (against.counts.get(key) ?? 0);
  return OPPOSITES.some(([left, right]) => (surplus(claim, passage, left) && surplus(passage, claim, right))
    || (surplus(claim, passage, right) && surplus(passage, claim, left)));
}

/** Compare one claim (citation markers already removed) with one prepared source. */
export function lexicalSupport(claimText: string, source: PreparedSource): LexicalSupport {
  const claim = terms(claimText), claimWords = [...claim.words.keys()], claimNumbers = [...claim.numbers];
  const original = (keys: string[]) => keys.map(key => claim.words.get(key)!);
  let best: { tier: number; candidate: Candidate; recall: number; missing: string[]; missingNumbers: string[]; tentative: boolean } | undefined;
  let near: { candidate: Candidate; recall: number; difference: LexicalDifference } | undefined;
  for (const candidate of source.candidates) {
    const missing = claimWords.filter(word => !candidate.terms.words.has(word));
    const matched = claimWords.length - missing.length, recall = claimWords.length ? matched / claimWords.length : 0;
    if (recall < 0.5 || matched < 2) continue;
    const missingNumbers = claimNumbers.filter(number => !candidate.terms.numbers.has(number));
    // A claimed figure is absent while the passage states another figure in its place.
    const otherNumber = missingNumbers.length > 0 && [...candidate.terms.numbers].some(number => !claim.numbers.has(number));
    const difference: LexicalDifference | undefined = claim.negated !== candidate.terms.negated ? "negation"
      : oppositeTerm(claim, candidate.terms) ? "opposite-term" : otherNumber ? "different-number" : undefined;
    if (difference) {
      if (candidate.sentences === 1 && (!near || recall > near.recall)) near = { candidate, recall, difference };
      continue;
    }
    const tentative = candidate.terms.tentative && !claim.tentative;
    const tier = recall >= 0.8 && claimWords.length >= 3 && missingNumbers.length === 0 && !tentative ? 2 : 1;
    // Prefer the stronger verdict, then one sentence over two, then closer wording, then the earlier passage.
    if (!best || tier > best.tier || (tier === best.tier && (candidate.sentences < best.candidate.sentences
      || (candidate.sentences === best.candidate.sentences && recall > best.recall))))
      best = { tier, candidate, recall, missing, missingNumbers, tentative };
  }
  const span = (candidate: Candidate): DraftExcerptSpan => ({ text: source.text.slice(candidate.start, candidate.end), start: candidate.start, end: candidate.end });
  if (best) return { verdict: best.tier === 2 ? "supported" : "partly-supported", excerpt: span(best.candidate),
    missingTerms: original(best.missing), missingNumbers: best.missingNumbers, ...(best.tentative ? { sourceTentative: true as const } : {}) };
  return { verdict: "not-found", missingTerms: original(claimWords.filter(word => !source.vocabulary.words.has(word))),
    missingNumbers: claimNumbers.filter(number => !source.vocabulary.numbers.has(number)),
    ...(near ? { closest: { ...span(near.candidate), difference: near.difference } } : {}) };
}
