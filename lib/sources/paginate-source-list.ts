/**
 * Cursor pagination over the public source list (GET /api/sources?limit=&cursor=).
 *
 * The DB always returns every active source — the agent's discovery pass and the browser's
 * payTo allowlist (lib/payments/client-payto-allowlist.ts) both need the complete set, so the
 * un-paginated default response must stay exhaustive. Pagination is therefore an opt-in view
 * applied here, after the fetch, for external API consumers that page through the catalog.
 *
 * The cursor encodes the (createdAt, id) of the last row served. That is a *position* in the
 * (createdAt, id) ordering, not a row reference: a source deactivated between two pages cannot
 * break iteration, and rows created in the same second (bulk import) cannot repeat or be
 * skipped, because id breaks the tie deterministically.
 */

/** Hard ceiling on page size; a larger requested limit is clamped, not rejected. */
export const MAX_SOURCE_PAGE_SIZE = 100;

export interface SourcePage<T> {
  items: T[];
  /** Present only when more rows remain past this page. */
  nextCursor?: string;
}

interface CursorKeys {
  id: string;
  createdAt: string;
}

export function encodeSourceCursor(row: CursorKeys): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id]), "utf8").toString("base64url");
}

/** Throws on a malformed cursor — the API route maps that to a 400. */
export function decodeSourceCursor(cursor: string): CursorKeys {
  const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw new Error("malformed cursor");
  }
  return { createdAt: parsed[0], id: parsed[1] };
}

/** ISO-8601 createdAt strings compare correctly as plain strings; id breaks ties. */
function compareRows(a: CursorKeys, b: CursorKeys): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function paginateSourceList<T extends CursorKeys>(
  rows: T[],
  opts: { limit: number; cursor?: string },
): SourcePage<T> {
  const limit = Math.max(1, Math.min(Math.floor(opts.limit), MAX_SOURCE_PAGE_SIZE));
  // Re-sort locally rather than trusting DB order: both adapters ORDER BY created_at only,
  // which leaves same-second rows in an unspecified relative order — not stable enough to
  // resume from a cursor.
  const sorted = [...rows].sort(compareRows);

  let start = 0;
  if (opts.cursor) {
    const after = decodeSourceCursor(opts.cursor);
    start = sorted.findIndex((row) => compareRows(row, after) > 0);
    if (start === -1) start = sorted.length; // cursor at/past the end → empty final page
  }

  const items = sorted.slice(start, start + limit);
  const hasMore = start + items.length < sorted.length;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeSourceCursor(last) : undefined,
  };
}
