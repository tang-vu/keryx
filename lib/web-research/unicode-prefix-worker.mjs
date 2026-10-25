/** Exact UTF-16 prefix, moving a cutoff inward only when it splits a codepoint.
 * No normalization, replacement characters or expansion beyond the caller cap.
 * This worker helper is traced by the existing *-worker.mjs deployment allowlist.
 * @param {string} text
 * @param {number} maximum
 */
export function unicodePrefix(text, maximum) {
  let end = Math.min(text.length, maximum);
  if (end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end] ?? "")) end--;
  return text.slice(0, end);
}
