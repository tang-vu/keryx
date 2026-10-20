import type { EvidenceDraftRequest } from "./evidence-draft";

type Claim = EvidenceDraftRequest["claims"][number];
export interface PassageEditHint { passage: string; start: number; end: number; inputType: string }

/** A browser selection is useful only when it explains the entire observed edit. */
function selectedEdit(previous: string, next: string, hint?: PassageEditHint) {
  if (!hint || hint.passage !== previous || !Number.isInteger(hint.start) || !Number.isInteger(hint.end)
    || hint.start < 0 || hint.end < hint.start || hint.end > previous.length) return;
  let { start, end } = hint;
  if (/^insert/.test(hint.inputType) || hint.inputType === "deleteByCut") {
    // The selection is the replaced range, including a collapsed insertion.
  } else if (/^delete(?:Content|Word|SoftLine|HardLine)(Backward|Forward)$/.test(hint.inputType)) {
    if (start === end) {
      const deleted = previous.length - next.length;
      if (deleted <= 0) return;
      if (hint.inputType.endsWith("Backward")) start -= deleted;
      else end += deleted;
    }
  } else return;
  const inserted = next.length - (previous.length - (end - start));
  if (start < 0 || end > previous.length || inserted < 0
    || previous.slice(0, start) !== next.slice(0, start)
    || previous.slice(end) !== next.slice(start + inserted)) return;
  return { before: start, after: end };
}

/** Keep only annotations provably outside the edit. Never relocate by searching for claim text.
 * Without a matching native edit hint, repeated text can give several equally small edit ranges;
 * annotations in that ambiguous region are withheld rather than assigned to another occurrence. */
export function rebaseEvidenceDraftClaims(previous: string, next: string, claims: readonly Claim[], hint?: PassageEditHint) {
  if (previous === next) return { claims: [...claims], removed: 0 };
  const delta = next.length - previous.length;
  let range = selectedEdit(previous, next, hint);
  if (!range) {
    const length = Math.min(previous.length, next.length);
    let prefix = 0, suffix = 0;
    while (prefix < length && previous[prefix] === next[prefix]) prefix++;
    while (suffix < length && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
    const unchanged = Math.min(length, prefix + suffix);
    // Union of all minimal contiguous edit ranges. Its outer regions map identically.
    range = { before: unchanged - suffix, after: prefix + previous.length - unchanged };
  }
  const retained: Claim[] = [];
  for (const claim of claims) {
    const shift = claim.end <= range.before ? 0 : claim.start >= range.after ? delta : undefined;
    if (shift === undefined) continue;
    const start = claim.start + shift, end = claim.end + shift;
    if (start < 0 || end > next.length || next.slice(start, end) !== previous.slice(claim.start, claim.end)) continue;
    retained.push({ ...claim, start, end });
  }
  return { claims: retained, removed: claims.length - retained.length };
}
