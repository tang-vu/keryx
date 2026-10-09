/** Stable nonsecurity reference key. Existing research BibTeX keys keep these bytes. */
export function referenceKey(identity: string, prefix = "keryx"): string {
  let hash = BigInt("0xcbf29ce484222325");
  for (const byte of new TextEncoder().encode(identity))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * BigInt("0x100000001b3"));
  return `${prefix}${hash.toString(16)}`;
}

/** Preserve date precision and refuse calendar normalization or guessed components. */
export function cslIssued(value?: string): { "date-parts": number[][] } | undefined {
  if (!value || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return;
  const parts = value.split("-").map(Number);
  const [year, month, day] = parts;
  if (year < 1000 || (month !== undefined && (month < 1 || month > 12))) return;
  if (day !== undefined) {
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.toISOString().slice(0, 10) !== value) return;
  }
  return { "date-parts": [parts] };
}

export interface CslName { family?: string; given?: string; literal?: string }
export interface CslReference {
  id: string;
  "citation-key": string;
  type: "article-journal" | "paper-conference" | "manuscript" | "webpage";
  title: string;
  URL: string;
  author?: CslName[];
  issued?: { "date-parts": number[][] };
  DOI?: string;
  "container-title"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  archive?: string;
  archive_location?: string;
  version?: string;
  note: string;
}

export function cslJsonContent(entries: readonly CslReference[]): string {
  // A duplicate key must not silently overwrite another exact reference in a consumer.
  if (new Set(entries.map(entry => entry.id)).size !== entries.length)
    throw new Error("Reference identifier collision");
  return JSON.stringify(entries, null, 2) + "\n";
}
