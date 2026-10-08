/** Native, inert feeds: no live transport, content, creator payout or settlement evidence. */
export const RECENCY_FEED_URL = "https://feeds.example.test/releases.xml";
export const RECENCY_ATOM_NS = "http://www.w3.org/2005/Atom";
export function recencyAtomEntry(id: string, published = "2026-10-07T12:00:00Z", extra = ""): string {
  return `<entry><id>urn:release:${id}</id><title>Release ${id}</title><link href="https://publisher.example.test/${id}"/>${published ? `<published>${published}</published>` : ""}${extra}</entry>`;
}
export function recencyAtomFeed(entries: string, extra = ""): string {
  return `<feed xmlns="${RECENCY_ATOM_NS}"><id>urn:feed:releases</id><link rel="self" href="${RECENCY_FEED_URL}"/>${extra}${entries}</feed>`;
}
export function recencyRssItem(id: string, pubDate = "Wed, 07 Oct 2026 12:00:00 GMT", extra = ""): string {
  return `<item><guid isPermaLink="false">release:${id}</guid><title>Release ${id}</title><link>https://publisher.example.test/${id}</link>${pubDate ? `<pubDate>${pubDate}</pubDate>` : ""}${extra}</item>`;
}
export function recencyRssFeed(items: string, extra = ""): string {
  return `<rss version="2.0"><channel><title>Releases</title>${extra}${items}</channel></rss>`;
}
