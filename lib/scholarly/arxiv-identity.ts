const VERSIONED_ID_PATTERN = "(?:\\d{4}\\.\\d{4,5}|[a-z-]+(?:\\.[a-z]{2})?\\/\\d{7})v[1-9]\\d*";
const VERSIONED_ID = new RegExp(`^${VERSIONED_ID_PATTERN}$`, "i");
const EXPLICIT_PREFIX = "(?:\\barxiv\\s*:?\\s*|https:\\/\\/arxiv\\.org\\/(?:abs|pdf|html)\\/)";
const REFERENCE_END = "(?:\\.pdf)?(?![\\w]|\\.[\\w])";
const LIST_WORD = "(?:and|or|with|versus|vs\\.?|và|với)";

/** A document identity must come from the whole canonical URL, never
 * from words or another URL embedded in its path, query, fragment or credentials.
 */
export function arxivDocumentId(value: string): string | undefined {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\\\u0000-\u0020\u007f]/u.test(value)) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.username || url.password) return undefined;
  if (url.protocol !== "https:" || url.hostname !== "arxiv.org" || url.port) return undefined;
  const path = /^\/(abs|pdf|html)\/(.+)$/.exec(url.pathname);
  if (!path) return undefined;
  const id = path[1] === "pdf" ? path[2].replace(/\.pdf$/, "") : path[2];
  return normalizeVersionedArxivId(id);
}

/** Normalize comparison/query identity without rewriting an observed provider URL. */
export function normalizeVersionedArxivId(value: string): string | undefined {
  if (!VERSIONED_ID.test(value)) return undefined;
  return value.toLowerCase().replace(/^([a-z-]+)\.([a-z]{2})\//, (_, archive: string, category: string) => `${archive}.${category.toUpperCase()}/`);
}

function referencedIds(text: string, prefix: string): string[] {
  const matches = text.matchAll(new RegExp(`${prefix}(${VERSIONED_ID_PATTERN})${REFERENCE_END}`, "gi"));
  return [...new Set([...matches].flatMap(match => {
    const id = normalizeVersionedArxivId(match[1]);
    return id ? [id] : [];
  }))];
}

/** Bounded explicit version intent; never infer a version or accept API operators.
 * Question text is intent, not authority for the identity of a fetched document.
 */
export function questionArxivIds(question: string, maxResults = 2): string[] {
  const limit = Math.max(0, Math.trunc(maxResults));
  if (!Number.isFinite(limit) || !limit) return [];
  const ids = new Set<string>();
  const explicit = new RegExp(`${EXPLICIT_PREFIX}(${VERSIONED_ID_PATTERN})${REFERENCE_END}`, "gi");
  // Inherit the prefix only across an adjacent list, never through unrelated prose.
  // Sticky matching advances one cursor without repeatedly slicing/rescanning input.
  const continuation = new RegExp(`\\s*(?:,\\s*(?:${LIST_WORD}\\s+)?|${LIST_WORD}\\s+|&\\s*)(?:${EXPLICIT_PREFIX})?(${VERSIONED_ID_PATTERN})${REFERENCE_END}`, "iy");
  for (let match = explicit.exec(question); match; match = explicit.exec(question)) {
    const id = normalizeVersionedArxivId(match[1]);
    if (id) ids.add(id);
    if (ids.size >= limit) return [...ids];
    continuation.lastIndex = explicit.lastIndex;
    for (let next = continuation.exec(question); next; next = continuation.exec(question)) {
      const nextId = normalizeVersionedArxivId(next[1]);
      if (nextId) ids.add(nextId);
      explicit.lastIndex = continuation.lastIndex;
      if (ids.size >= limit) return [...ids];
    }
  }
  return [...ids];
}

/** Decomposition may drop the arXiv prefix. Check every target ID, independently
 * of discovery's two-document request cap, using the same versioned grammar.
 */
export function targetArxivIds(target: string): string[] {
  return referencedIds(target, `(?:^|[^\\w.])(?:${EXPLICIT_PREFIX})?`);
}
