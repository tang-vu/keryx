import type { Citation } from "./types";

export type CitationExportFormat = "bibtex" | "ris";

interface Reference {
  key: string;
  title: string;
  url: string;
  source: string;
  date?: string;
  note: string;
}

// Keep every value on one line: RIS interprets new lines as new fields/records.
function text(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
}

function articleUrl(value?: string): string | undefined {
  if (!value || /[\u0000-\u0020\u007f-\u009f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

function publicationDate(value?: string): string | undefined {
  // Avoid Date's normalization of impossible dates and timezone-dependent coercion.
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$)/);
  if (!match) return;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (value!.includes("T") && !Number.isFinite(Date.parse(value!))) return;
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : undefined;
}

// A stable, nonsecurity identifier; resolve the unlikely digest collision per file below.
function citationKey(identity: string): string {
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  for (const byte of new TextEncoder().encode(identity)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * prime);
  return `keryx${hash.toString(16)}`;
}

function references(citations: readonly Citation[]) {
  const entries: Reference[] = [];
  const seen = new Set<string>();
  const keys = new Map<string, number>();
  let omitted = 0;
  for (const citation of citations) {
    const url = articleUrl(citation.itemUrl);
    const title = text(citation.itemTitle ?? "");
    if (!url || !title) { omitted++; continue; }
    // Do not collapse distinct purchased versions or article identities onto one URL.
    const identity = JSON.stringify([citation.sourceId, citation.itemId ?? "", url, citation.contentVersion ?? ""]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const source = text(citation.sourceName);
    const version = text(citation.contentVersion ?? "");
    const itemId = text(citation.itemId ?? "");
    const baseKey = citationKey(identity);
    const keyCount = (keys.get(baseKey) ?? 0) + 1;
    keys.set(baseKey, keyCount);
    entries.push({ key: keyCount === 1 ? baseKey : `${baseKey}_${keyCount}`, title, url, source, date: publicationDate(citation.itemPublishedAt),
      note: `Cited by Keryx [${text(citation.marker)}]. Source: ${source}.${itemId ? ` Item: ${itemId}.` : ""}${version ? ` Content version: ${version}.` : ""} Bibliographic metadata is limited to the recorded article identity.` });
  }
  return { entries, omitted };
}

// Escape literal text before putting it in brace-delimited BibTeX fields.
function bibtexText(value: string): string {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&",
    "_": "\\_", "#": "\\#", "$": "\\$", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
  };
  return value.replace(/[\\{}%&_#$^~]/g, char => replacements[char]);
}

export function buildCitationExport(citations: readonly Citation[], format: CitationExportFormat) {
  const { entries, omitted } = references(citations);
  const content = entries.map((entry) => {
    if (format === "ris") return [
      "TY  - WEB", `TI  - ${entry.title}`, `UR  - ${entry.url}`,
      ...(entry.source ? [`T2  - ${entry.source}`] : []),
      ...(entry.date ? [`PY  - ${entry.date.replaceAll("-", "/")}`] : []),
      `N1  - ${entry.note}`, "ER  - ",
    ].join("\r\n");
    const fields = [
      ["title", `{${bibtexText(entry.title)}}`], ["url", bibtexText(entry.url)],
      ...(entry.date ? [["year", entry.date.slice(0, 4)]] : []),
      ["note", bibtexText(entry.note)],
    ];
    return `@misc{${entry.key},\n${fields.map(([key, value]) => `  ${key} = {${value}}`).join(",\n")}\n}`;
  }).join(format === "ris" ? "\r\n\r\n" : "\n\n");
  return { content: content ? content + (format === "ris" ? "\r\n" : "\n") : "", count: entries.length, omitted };
}
