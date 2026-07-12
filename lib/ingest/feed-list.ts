/**
 * Feed-list parsing for bulk import, shared by the client (parse a paste) and the server
 * (sanitise the resulting array). Kept apart from rss.ts, which reads a single live feed.
 */

/** Hard cap on how many feeds one bulk import may register — bounds the fan-out of feed reads. */
export const MAX_BULK_FEEDS = 20;

/**
 * Turn a freeform paste into candidate feed URLs.
 *   - OPML / XML export → every `xmlUrl="…"` attribute.
 *   - Otherwise a newline/comma separated list.
 * Does not validate or dedupe — that is the server's job (sanitizeFeedUrls).
 */
export function parseFeedList(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (/<(\?xml|opml|outline)/i.test(trimmed)) {
    const urls: string[] = [];
    const re = /xmlUrl\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed))) urls.push(m[1].trim());
    return urls;
  }
  return trimmed
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Keep only http(s) URLs, dedupe case-insensitively (feeds are polled verbatim, so the same URL
 * in two cases is one source), and cap the count. Accepts `unknown` so it can guard a raw request
 * body directly.
 */
export function sanitizeFeedUrls(raw: unknown, max = MAX_BULK_FEEDS): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const url = entry.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}
