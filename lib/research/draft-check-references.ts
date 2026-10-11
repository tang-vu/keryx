/** Bounded, zero-I/O reference-list reading for the private draft check.
 * Nothing here resolves a DOI or URL: "identified" means a syntactically valid
 * locator was written in the list, never that the work exists or was read. */

export type DraftReferenceFormat = "bibtex" | "ris" | "list";
export type DraftReferenceStatus = "identified" | "described" | "unresolved";
export type DraftReferenceProblem = "no-identifier" | "duplicate-key" | "unreadable-entry";
export interface DraftReference {
  key: string;
  /** One-based position used by numeric markers such as [3]. */
  number: number;
  status: DraftReferenceStatus;
  problem?: DraftReferenceProblem;
  title?: string;
  authorFamilies: string[];
  year?: string;
  doi?: string;
  url?: string;
}

export const MAX_DRAFT_REFERENCES = 64;
const MAX_FIELD = 1000;
const DOI = /\b10\.\d{4,9}\/[^\s"<>{}]+/i;

const clean = (value: string) => value.replace(/[{}]/g, "").replace(/\\[a-zA-Z]+\s*|\\./g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD);

function httpsUrl(value: string | undefined): string | undefined {
  const candidate = value?.trim().replace(/[)\].,;]+$/, "");
  if (!candidate || candidate.length > 2048 || /[<>"\s\u0000-\u001f\u007f-\u009f]/u.test(candidate)) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? candidate : undefined;
  } catch { return undefined; }
}

function doiOf(value: string | undefined): string | undefined {
  const match = value?.match(DOI)?.[0].replace(/[).,;\]]+$/, "");
  return match ? match.toLowerCase() : undefined;
}

/** "Family, Given" or "Given Family"; corporate names in braces stay whole. */
function familyName(author: string): string | undefined {
  const name = author.trim();
  if (!name || /^others$/i.test(name)) return undefined;
  const family = name.includes(",") ? name.split(",")[0] : name.split(/\s+/).at(-1)!;
  return clean(family) || undefined;
}

interface RawReference { key?: string; title?: string; authors: string[]; year?: string; doi?: string; url?: string; unreadable?: boolean }

function finish(rows: RawReference[]): DraftReference[] {
  if (rows.length > MAX_DRAFT_REFERENCES) throw new Error("Too many references");
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const number = index + 1, key = row.key && /^[^\s,{}]{1,120}$/u.test(row.key) ? row.key : `ref${number}`;
    const duplicate = seen.has(key);
    seen.add(key);
    const title = row.title ? clean(row.title) || undefined : undefined;
    const authorFamilies = row.authors.map(familyName).filter((name): name is string => !!name).slice(0, 32);
    const year = row.year?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1];
    const doi = doiOf(row.doi), url = httpsUrl(row.url);
    const base = { key: duplicate ? `${key}#${number}` : key, number, authorFamilies,
      ...(title ? { title } : {}), ...(year ? { year } : {}), ...(doi ? { doi } : {}), ...(url ? { url } : {}) };
    if (duplicate) return { ...base, status: "unresolved" as const, problem: "duplicate-key" as const };
    if (row.unreadable) return { ...base, status: "unresolved" as const, problem: "unreadable-entry" as const };
    if (doi || url) return { ...base, status: "identified" as const };
    if (title || (authorFamilies.length && year)) return { ...base, status: "described" as const, problem: "no-identifier" as const };
    return { ...base, status: "unresolved" as const, problem: "no-identifier" as const };
  });
}

/** Reads one balanced BibTeX value starting at `index`; returns the raw value and next index. */
function bibtexValue(text: string, index: number): { value: string; next: number } | undefined {
  const open = text[index];
  if (open === "{") {
    let depth = 0;
    for (let cursor = index; cursor < text.length; cursor++) {
      if (text[cursor] === "\\") { cursor++; continue; }
      if (text[cursor] === "{") depth++;
      else if (text[cursor] === "}" && --depth === 0) return { value: text.slice(index + 1, cursor), next: cursor + 1 };
    }
    return undefined;
  }
  if (open === "\"") {
    let depth = 0;
    for (let cursor = index + 1; cursor < text.length; cursor++) {
      if (text[cursor] === "\\") { cursor++; continue; }
      if (text[cursor] === "{") depth++;
      else if (text[cursor] === "}") depth--;
      else if (text[cursor] === "\"" && depth <= 0) return { value: text.slice(index + 1, cursor), next: cursor + 1 };
    }
    return undefined;
  }
  const bare = /^[A-Za-z0-9_.:+-]+/.exec(text.slice(index, index + 200));
  return bare ? { value: bare[0], next: index + bare[0].length } : undefined;
}

function parseBibtex(text: string): RawReference[] {
  const rows: RawReference[] = [], entry = /@([A-Za-z]+)\s*[{(]\s*/g;
  for (let match = entry.exec(text); match; match = entry.exec(text)) {
    if (/^(?:comment|string|preamble)$/i.test(match[1])) continue;
    const keyMatch = /^([^\s,{}()=]*)\s*,/.exec(text.slice(entry.lastIndex, entry.lastIndex + 200));
    if (!keyMatch) { rows.push({ authors: [], unreadable: true }); continue; }
    const row: RawReference = { key: keyMatch[1] || undefined, authors: [] };
    let cursor = entry.lastIndex + keyMatch[0].length, complete = false;
    for (let fields = 0; fields < 64; fields++) {
      const rest = /^\s*(?:([A-Za-z][A-Za-z0-9_-]*)\s*=\s*|([})]))/.exec(text.slice(cursor, cursor + 400));
      if (!rest) break;
      cursor += rest[0].length;
      if (rest[2]) { complete = true; break; }
      const parsed = bibtexValue(text, cursor);
      if (!parsed) break;
      const name = rest[1].toLowerCase(), value = parsed.value;
      if (name === "title") row.title = value;
      else if (name === "author") row.authors = value.split(/\s+and\s+/i);
      else if (name === "year" || (name === "date" && !row.year)) row.year = value;
      else if (name === "doi") row.doi = value;
      else if (name === "url" && !row.url) row.url = value;
      cursor = parsed.next;
      const separator = /^\s*,/.exec(text.slice(cursor, cursor + 200));
      if (separator) cursor += separator[0].length;
    }
    if (!complete) row.unreadable = true;
    rows.push(row);
    entry.lastIndex = Math.max(entry.lastIndex, cursor);
  }
  return rows;
}

function parseRis(text: string): RawReference[] {
  const rows: RawReference[] = [];
  let row: RawReference | undefined;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const tagged = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/.exec(line.trim());
    if (!tagged) continue;
    const [, tag, value] = tagged;
    if (tag === "TY") { if (row) rows.push({ ...row, unreadable: true }); row = { authors: [] }; continue; }
    if (!row) continue;
    if (tag === "ER") { rows.push(row); row = undefined; }
    else if (tag === "AU" || tag === "A1") row.authors.push(value);
    else if ((tag === "TI" || tag === "T1") && !row.title) row.title = value;
    else if ((tag === "PY" || tag === "Y1" || tag === "DA") && !row.year) row.year = value;
    else if (tag === "DO") row.doi = value;
    else if (tag === "UR" && !row.url) row.url = value;
    else if (tag === "ID") row.key = value.trim();
  }
  // A record without its terminator is reported, never silently completed.
  if (row) rows.push({ ...row, unreadable: true });
  return rows;
}

/** One reference per non-empty line: a DOI, an https link, or a formatted citation. */
function parseList(text: string): RawReference[] {
  return text.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const body = line.replace(/^(?:\[\d{1,3}\]|\d{1,3}[.)])\s*/, "");
    const url = body.match(/https:\/\/[^\s<>"]+/)?.[0];
    const doi = doiOf(body);
    const prose = body.replace(/https?:\/\/[^\s<>"]+/g, " ").replace(DOI, " ").replace(/\bdoi:\s*/i, " ").trim();
    const family = /^([\p{Lu}][\p{L}\p{M}'’-]+),/u.exec(prose)?.[1];
    return { authors: family ? [`${family},`] : [], year: prose, doi, url: url && !/^https:\/\/(?:dx\.)?doi\.org\//i.test(url) ? url : undefined,
      // Free text is kept only as a description; it is not parsed into a trusted title.
      title: prose.length >= 12 ? prose : undefined };
  });
}

export function detectDraftReferenceFormat(text: string): DraftReferenceFormat {
  if (/^\s*@[A-Za-z]+\s*[{(]/m.test(text)) return "bibtex";
  if (/^\s*TY\s{1,2}-/m.test(text)) return "ris";
  return "list";
}

export function parseDraftReferences(format: DraftReferenceFormat, text: string): DraftReference[] {
  return finish(format === "bibtex" ? parseBibtex(text) : format === "ris" ? parseRis(text) : parseList(text));
}
