/**
 * Atom feed for the public answer archive. Keryx onboards creators by reading
 * their RSS feeds; this is the same door in the other direction — the archive
 * of paid, cited answers becomes a feed any reader, aggregator, or agent can
 * subscribe to. Pure XML building so the route handler stays a thin shell and
 * the escaping/structure is unit-testable.
 */

import type { ArchiveEntry } from "./answers-archive";

/** Entries per feed — enough for any reader's backfill without shipping the whole corpus. */
export const FEED_ENTRY_LIMIT = 60;

/** Escape a string for use in XML text nodes and attribute values. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Normalize a stored timestamp to the RFC 3339 form Atom requires. */
function rfc3339(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function entryXml(e: ArchiveEntry, base: string): string {
  const url = `${base}/dispatch/${e.id}`;
  const sources =
    e.sourceNames.length > 0 ? ` Sources: ${e.sourceNames.slice(0, 6).join(", ")}.` : "";
  const summary =
    `${e.answerSnippet} — ${e.citationCount} source${e.citationCount !== 1 ? "s" : ""} cited, ` +
    `$${e.toCreators.toFixed(4)} USDC paid to the writers it quoted.${sources}`;
  return [
    "  <entry>",
    `    <title>${xmlEscape(e.question)}</title>`,
    `    <id>${xmlEscape(url)}</id>`,
    `    <link rel="alternate" type="text/html" href="${xmlEscape(url)}"/>`,
    `    <updated>${rfc3339(e.createdAt)}</updated>`,
    `    <summary>${xmlEscape(summary)}</summary>`,
    "  </entry>",
  ].join("\n");
}

/**
 * Render the archive as an Atom 1.0 document. Entries arrive newest-first from
 * buildArchive; the feed's own <updated> is the newest entry's timestamp so a
 * quiet archive doesn't look freshly changed on every poll.
 */
export function buildAnswersFeedXml(entries: ArchiveEntry[], base: string): string {
  const top = entries.slice(0, FEED_ENTRY_LIMIT);
  const updated = top.length > 0 ? rfc3339(top[0].createdAt) : new Date(0).toISOString();
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>Keryx Answer Archive</title>",
    "  <subtitle>Every question Keryx has answered — each grounded in cited sources and settled with a real USDC micropayment to the writers it quoted.</subtitle>",
    `  <id>${xmlEscape(`${base}/answers`)}</id>`,
    `  <link rel="alternate" type="text/html" href="${xmlEscape(`${base}/answers`)}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${xmlEscape(`${base}/answers/feed.xml`)}"/>`,
    `  <updated>${updated}</updated>`,
    "  <author>",
    "    <name>Keryx</name>",
    `    <uri>${xmlEscape(base)}</uri>`,
    "  </author>",
    ...top.map((e) => entryXml(e, base)),
    "</feed>",
    "",
  ].join("\n");
}
