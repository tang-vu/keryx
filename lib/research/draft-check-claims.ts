import type { DraftReference } from "./draft-check-references";

/** Exact claim spans and citation markers in the unchanged passage. Offsets count
 * UTF-16 code units. A sentence is never rewritten, merged with prose or repaired. */

export type DraftMarkerKind = "numeric" | "latex" | "pandoc" | "author-year";
export type DraftTargetProblem = "unresolved" | "ambiguous" | "year-differs";
export interface DraftCitationTarget {
  /** What the passage wrote: a number, a citation key, or "Family Year". */
  token: string;
  reference?: string;
  problem?: DraftTargetProblem;
  /** Listed works by the same first author when only the year differs, or all ambiguous matches. */
  candidates?: string[];
}
export interface DraftMarker {
  kind: DraftMarkerKind;
  start: number;
  end: number;
  targets: DraftCitationTarget[];
  /** First author named in running text directly before a numeric or key marker. */
  impliedAuthor?: string;
  /** Start of that running-text author mention; excluded from wording comparison. */
  mentionStart?: number;
}
export interface DraftClaimSpan { start: number; end: number; markers: DraftMarker[] }

export const MAX_DRAFT_CLAIMS = 128;
const NAME = String.raw`(?:(?:van|von|de|del|der|den|di|la|le)\s+)*[\p{Lu}][\p{L}\p{M}'’-]+`;
const GROUP = String.raw`(?:\s+et\s+al\.?|\s+(?:and|&)\s+${NAME})`;
const YEAR = String.raw`(?:1[5-9]|20)\d{2}`;
const PAGES = String.raw`(?:,\s*(?:pp?\.)?\s*[\d–-]+)?`;
const NUMERIC = /\[(\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)\]/g;
const LATEX = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]{0,80}\])*\{([^{}]{1,400})\}/g;
const PANDOC = /(?<![\p{L}\p{N}.])@([A-Za-z0-9_][A-Za-z0-9_:.-]*[A-Za-z0-9_]|[A-Za-z0-9_])/gu;
const NARRATIVE = new RegExp(String.raw`(${NAME})(${GROUP})?\s*\((${YEAR})[a-z]?${PAGES}\)`, "gu");
const PARENTHETICAL = new RegExp(String.raw`\(([^()]{0,300})\)`, "gu");
const UNIT = new RegExp(String.raw`^(?:(?:see|also|cf\.|e\.g\.,?)\s+)*(${NAME})${GROUP}?,?\s+(${YEAR})[a-z]?${PAGES}$`, "u");
const MENTION = new RegExp(String.raw`(${NAME})${GROUP},?[\s~]*$`, "u");
const ABBREVIATION = /(?:\bet al|\be\.g|\bi\.e|\bFig|\bFigs|\bEq|\bEqs|\bvs|\bcf|\bapprox|\bDr|\bProf|\bSec|\bRef|\bRefs|\bpp?)\.$/i;
const AFTER_STOP = /([.!?])\s*(?:\[\d{1,3}(?:\s*[-–,]\s*\d{1,3})*\])+/g;

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/^(?:(?:van|von|de|del|der|den|di|la|le)\s+)+/, "");
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** Same-length boundary view. A numeric marker is one opaque word, and a marker written
 * after the full stop ("…is large.[3] Next…") stays with the sentence before it. */
function boundaryView(passage: string): string {
  return passage
    .replace(AFTER_STOP, (match: string, stop: string) => `${"a".repeat(match.length - 1)}${stop}`)
    .replace(NUMERIC, match => "a".repeat(match.length));
}

function sentenceSpans(passage: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const sentence of segmenter.segment(boundaryView(passage))) {
    const body = sentence.segment;
    const start = sentence.index + body.length - body.trimStart().length, end = sentence.index + body.trimEnd().length;
    if (end <= start) continue;
    const previous = spans.at(-1);
    if (previous && ABBREVIATION.test(passage.slice(previous.start, previous.end)) && !/[\r\n]/.test(passage.slice(previous.end, start)))
      previous.end = end;
    else spans.push({ start, end });
  }
  return spans;
}

function numericTargets(body: string, references: readonly DraftReference[]): DraftCitationTarget[] | undefined {
  const numbers: number[] = [];
  for (const part of body.split(",")) {
    const [first, last] = part.split(/[-–]/).map(value => Number(value.trim()));
    if (!Number.isInteger(first) || first < 1) return undefined;
    if (last === undefined) { numbers.push(first); continue; }
    // A reversed or implausibly wide range is not read as a citation list.
    if (!Number.isInteger(last) || last < first || last - first > 20) return undefined;
    for (let value = first; value <= last; value++) numbers.push(value);
  }
  return [...new Set(numbers)].map(value => {
    const reference = references.find(row => row.number === value && row.problem !== "duplicate-key");
    return reference ? { token: String(value), reference: reference.key } : { token: String(value), problem: "unresolved" as const };
  });
}

function keyTarget(token: string, references: readonly DraftReference[]): DraftCitationTarget {
  const reference = references.find(row => row.key === token);
  return reference ? { token, reference: reference.key } : { token, problem: "unresolved" };
}

function authorYearTarget(family: string, year: string, references: readonly DraftReference[]): DraftCitationTarget {
  const token = `${family} ${year}`, name = fold(family);
  const sameAuthor = references.filter(row => row.authorFamilies[0] !== undefined && fold(row.authorFamilies[0]) === name);
  const exact = sameAuthor.filter(row => row.year === year);
  if (exact.length === 1) return { token, reference: exact[0].key };
  if (exact.length > 1) return { token, problem: "ambiguous", candidates: exact.map(row => row.key) };
  return sameAuthor.length ? { token, problem: "year-differs", candidates: sameAuthor.map(row => row.key) } : { token, problem: "unresolved" };
}

function markersIn(passage: string, span: { start: number; end: number }, references: readonly DraftReference[]): DraftMarker[] {
  const text = passage.slice(span.start, span.end), found: DraftMarker[] = [];
  const mention = (marker: DraftMarker): DraftMarker => {
    const before = MENTION.exec(text.slice(0, marker.start - span.start));
    return before ? { ...marker, impliedAuthor: before[1], mentionStart: span.start + before.index } : marker;
  };
  for (const match of text.matchAll(NUMERIC)) {
    const targets = numericTargets(match[1], references);
    if (targets) found.push(mention({ kind: "numeric", start: span.start + match.index, end: span.start + match.index + match[0].length, targets }));
  }
  for (const match of text.matchAll(LATEX)) {
    const keys = [...new Set(match[1].split(",").map(key => key.trim()).filter(Boolean))].slice(0, 16);
    if (keys.length) found.push(mention({ kind: "latex", start: span.start + match.index, end: span.start + match.index + match[0].length,
      targets: keys.map(key => keyTarget(key, references)) }));
  }
  for (const match of text.matchAll(PANDOC))
    found.push(mention({ kind: "pandoc", start: span.start + match.index, end: span.start + match.index + match[0].length, targets: [keyTarget(match[1], references)] }));
  for (const match of text.matchAll(NARRATIVE)) {
    const target = authorYearTarget(match[1], match[3], references);
    // "In March (2020)" is prose, not a citation, unless it names a group or a listed author.
    if (target.problem === "unresolved" && !match[2]) continue;
    found.push({ kind: "author-year", start: span.start + match.index, end: span.start + match.index + match[0].length, targets: [target] });
  }
  for (const match of text.matchAll(PARENTHETICAL)) {
    const units = match[1].split(";").map(part => UNIT.exec(part.trim()));
    if (!units.every(Boolean)) continue;
    found.push({ kind: "author-year", start: span.start + match.index, end: span.start + match.index + match[0].length,
      targets: units.slice(0, 16).map(unit => authorYearTarget(unit![1], unit![2], references)) });
  }
  found.sort((left, right) => left.start - right.start || right.end - left.end);
  const kept: DraftMarker[] = [];
  for (const marker of found) if (!kept.length || marker.start >= kept.at(-1)!.end) kept.push(marker);
  return kept;
}

export function splitDraftClaims(passage: string, references: readonly DraftReference[]): DraftClaimSpan[] {
  const spans = sentenceSpans(passage);
  if (spans.length > MAX_DRAFT_CLAIMS) throw new Error("Too many claims");
  return spans.map(span => ({ ...span, markers: markersIn(passage, span, references) }));
}

/** Markers for caller-chosen spans; the caller's boundaries are kept exactly. */
export const draftClaimMarkers = (passage: string, span: { start: number; end: number }, references: readonly DraftReference[]) =>
  markersIn(passage, span, references);

/** Claim wording with citation markers and cited-author mentions blanked, for comparison only. */
export function claimComparisonText(passage: string, claim: DraftClaimSpan): string {
  let text = "", cursor = claim.start;
  for (const marker of claim.markers) {
    const from = Math.max(cursor, marker.mentionStart ?? marker.start);
    text += `${passage.slice(cursor, from)} `;
    cursor = Math.max(cursor, marker.end);
  }
  return text + passage.slice(cursor, claim.end);
}

/** True when running text names a first author who is not an author of the cited reference. */
export function impliesDifferentWork(marker: DraftMarker, reference: DraftReference): boolean {
  if (!marker.impliedAuthor || !reference.authorFamilies.length) return false;
  const implied = fold(marker.impliedAuthor);
  return !reference.authorFamilies.some(family => fold(family) === implied);
}
