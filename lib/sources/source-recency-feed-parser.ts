import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { SaxesParser, type SaxesTagNS } from "saxes";

import { sourceRecencyPublicationDate } from "./source-recency-feed-date";

const ATOM = "http://www.w3.org/2005/Atom";
const TOMBSTONE = "http://purl.org/atompub/tombstones/1.0";
const HISTORY = "http://purl.org/syndication/history/1.0";
const RELATION_IRI = "http://www.iana.org/assignments/relation/";
export const SOURCE_RECENCY_FEED_LIMITS = Object.freeze({ maxBytes: 2_000_000, maxItems: 1000,
  maxNodes: 20_000, maxDepth: 32, maxFieldChars: 2000, timeoutMs: 8000, maxHops: 0 });

export interface SourceRecencyFeedEntry {
  readonly position: number;
  readonly nativeId?: Readonly<{ field: "atom:id" | "rss:guid"; rawValue: string }>;
  readonly itemUrl?: string;
  readonly title?: string;
  readonly publication: Readonly<{ field: "atom:published" | "rss:pubDate"; rawValues: readonly string[];
    status: "valid" | "missing" | "invalid" | "ambiguous"; publishedAt?: string }>;
  readonly updatedRawValues: readonly string[];
  readonly issues: readonly string[];
  /** Exact XML entry bytes, never the article's paid/cache contentVersion. */
  readonly entryMetadataVersion: string;
}
export interface ParsedSourceRecencyFeed {
  readonly format: "atom" | "rss2";
  readonly nativeFeedId?: string;
  readonly declaredSelfUrls: readonly string[];
  readonly membership: "complete-document";
  readonly filteredCount: 0;
  readonly truncated: false;
  readonly entries: readonly SourceRecencyFeedEntry[];
}

/** Identity only; the transport separately proves public DNS/socket reachability. */
export function sourceRecencyFeedUrl(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 2000 || !raw.isWellFormed() || /[\\\s\u0000-\u001f\u007f]/u.test(raw)) return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}

/** Pure XML parsing does not mint a current-feed observation capability. */
export async function parseSourceRecencyFeed(xml: string, signal?: AbortSignal): Promise<ParsedSourceRecencyFeed> {
  if (Buffer.byteLength(xml, "utf8") > SOURCE_RECENCY_FEED_LIMITS.maxBytes) throw new Error("feed-byte-limit");
  const parser = new SaxesParser({ xmlns: true, position: true });
  const stack: SaxesTagNS[] = [];
  const entries: SourceRecencyFeedEntry[] = [];
  const selfUrls: string[] = [], feedIds: string[] = [];
  let format: "atom" | "rss2" | undefined, nodes = 0, channels = 0, entryStart = -1;
  let item: { depth: number; ids: string[]; titles: string[]; links: string[]; dates: string[]; updated: string[]; issues: string[] } | undefined;
  let capture: { depth: number; target: string[]; value: string; scalar: boolean; preserve: boolean } | undefined;
  const abort = () => { if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); };
  const scalar = (target: string[], preserve = false) => { capture = { depth: stack.length, target, value: "", scalar: true, preserve }; };
  const attr = (tag: SaxesTagNS, name: string) => Object.values(tag.attributes).find(a => a.uri === "" && a.local === name)?.value;
  const relation = (tag: SaxesTagNS) => {
    const raw = attr(tag, "rel");
    if (raw === undefined) return "alternate";
    if (!raw || /[\s\u0000-\u001f\u007f]/u.test(raw)) throw new Error("feed-link-relation-unqualified");
    // RFC4287 4.2.7.2: short registered names and this exact IANA IRI form are equivalent.
    if (raw.startsWith(RELATION_IRI)) return raw.slice(RELATION_IRI.length);
    // HTTPS is not the normative equivalent; refuse it instead of promoting an extension IRI.
    if (raw.startsWith("https://www.iana.org/assignments/relation/")) throw new Error("feed-link-relation-unqualified");
    if (!/^[A-Za-z_][A-Za-z0-9._-]*$/u.test(raw)) {
      try { new URL(raw); } catch { throw new Error("feed-link-relation-unqualified"); }
    }
    return raw;
  };
  parser.on("error", error => { throw error; });
  parser.on("doctype", () => { throw new Error("feed-doctype-refused"); });
  parser.on("xmldecl", decl => {
    if (decl.version !== "1.0" || (decl.encoding && !/^utf-?8$/iu.test(decl.encoding))) throw new Error("feed-encoding-unqualified");
  });
  parser.on("opentagstart", () => {
    abort();
    if (++nodes > SOURCE_RECENCY_FEED_LIMITS.maxNodes) throw new Error("feed-node-limit");
  });
  parser.on("opentag", tag => {
    if (stack.length >= SOURCE_RECENCY_FEED_LIMITS.maxDepth || Object.keys(tag.attributes).length > 32)
      throw new Error("feed-structure-limit");
    // xml:base changes URL interpretation. It is deliberately unsupported rather than ignored.
    if (Object.values(tag.attributes).some(a => a.uri === "http://www.w3.org/XML/1998/namespace" && a.local === "base"))
      throw new Error("feed-xml-base-unqualified");
    if (capture) capture.scalar = false;
    stack.push(tag);
    const linkRelation = tag.uri === ATOM && tag.local === "link" ? relation(tag) : undefined;
    if (stack.length === 1) {
      if (tag.uri === ATOM && tag.local === "feed") format = "atom";
      else if (tag.uri === "" && tag.local === "rss" && attr(tag, "version") === "2.0") format = "rss2";
      else throw new Error("feed-format-unqualified");
    }
    const nativeEntry = (tag.uri === ATOM && tag.local === "entry") || (tag.uri === "" && tag.local === "item");
    if (tag.uri === TOMBSTONE && tag.local === "deleted-entry") throw new Error("feed-membership-unqualified");
    if (tag.uri === HISTORY && tag.local === "archive") throw new Error("feed-pagination-unqualified");
    if (format === "rss2" && stack.length === 2 && tag.uri === "" && tag.local === "channel") channels++;
    const entryDepth = format === "atom" ? 2 : 3;
    if (nativeEntry) {
      if (item || stack.length !== entryDepth || (format === "rss2" && (stack[1]?.local !== "channel" || stack[1]?.uri !== "")) ||
        (format === "atom" ? tag.uri !== ATOM : tag.uri !== "")) throw new Error("feed-entry-placement-unqualified");
      if (entries.length >= SOURCE_RECENCY_FEED_LIMITS.maxItems) throw new Error("feed-item-limit");
      entryStart = xml.lastIndexOf("<", parser.position - 1);
      item = { depth: stack.length, ids: [], titles: [], links: [], dates: [], updated: [], issues: [] };
    } else if (item && stack.length === item.depth + 1) {
      const native = format === "atom" ? tag.uri === ATOM : tag.uri === "";
      if (native && tag.local === (format === "atom" ? "id" : "guid")) scalar(item.ids);
      if (native && tag.local === "title") scalar(item.titles);
      if (native && tag.local === (format === "atom" ? "published" : "pubDate")) scalar(item.dates, true);
      if (format === "atom" && tag.uri === ATOM && tag.local === "updated") scalar(item.updated, true);
      if (format === "rss2" && native && tag.local === "link") scalar(item.links);
      if (format === "atom" && tag.uri === ATOM && tag.local === "link" && linkRelation === "alternate") {
        const href = attr(tag, "href");
        if (href) item.links.push(href); else item.issues.push("missing-entry-link");
      }
    }
    const feedChild = !item && stack.length === (format === "atom" ? 2 : 3);
    if (feedChild && format === "atom" && tag.uri === ATOM && tag.local === "id") scalar(feedIds);
    if (feedChild && tag.uri === ATOM && tag.local === "link") {
      if (["next", "previous", "prev", "first", "last", "next-archive", "prev-archive", "current"].includes(linkRelation ?? "")) throw new Error("feed-pagination-unqualified");
      if (linkRelation === "self") {
        const href = attr(tag, "href");
        if (!href) throw new Error("feed-self-url-unqualified");
        selfUrls.push(href);
      }
    }
  });
  const text = (value: string) => {
    if (!capture) return;
    capture.value += value;
    if (capture.value.length > SOURCE_RECENCY_FEED_LIMITS.maxFieldChars) throw new Error("feed-field-limit");
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    if (capture?.depth === stack.length) {
      if (!capture.scalar) throw new Error("feed-nested-identity-field");
      capture.target.push(capture.preserve ? capture.value : capture.value.trim()); capture = undefined;
    }
    if (item?.depth === stack.length) {
      const field = format === "atom" ? "atom:published" : "rss:pubDate";
      const publishedAt = item.dates.length === 1 ? sourceRecencyPublicationDate(field, item.dates[0].trim()) : null;
      const urls = item.links.map(sourceRecencyFeedUrl);
      const itemUrl = urls.length === 1 && urls[0] ? urls[0] : undefined;
      if (!itemUrl) item.issues.push("entry-link-unqualified");
      if (item.ids.length > 1 || item.ids.some(id => !id)) item.issues.push("entry-native-id-unqualified");
      if (format === "atom" && item.ids.length !== 1) item.issues.push("entry-native-id-unqualified");
      if (item.titles.length !== 1 || !item.titles[0]) item.issues.push("entry-title-unqualified");
      entries.push(Object.freeze({ position: entries.length,
        ...(item.ids.length === 1 && item.ids[0] ? { nativeId: Object.freeze({ field: format === "atom" ? "atom:id" as const : "rss:guid" as const, rawValue: item.ids[0] }) } : {}),
        ...(itemUrl ? { itemUrl } : {}), ...(item.titles.length === 1 ? { title: item.titles[0] } : {}),
        publication: Object.freeze({ field, rawValues: Object.freeze(item.dates),
          status: item.dates.length === 0 ? "missing" : item.dates.length > 1 ? "ambiguous" : publishedAt ? "valid" : "invalid",
          ...(publishedAt ? { publishedAt } : {}) }), updatedRawValues: Object.freeze(item.updated), issues: Object.freeze(item.issues),
        entryMetadataVersion: `sha256:${createHash("sha256").update(xml.slice(entryStart, parser.position)).digest("hex")}` }));
      item = undefined;
    }
    stack.pop();
  });
  for (let at = 0; at < xml.length; at += 4096) {
    abort(); parser.write(xml.slice(at, at + 4096));
    await setImmediate();
  }
  abort(); parser.close();
  if (!format || (format === "rss2" && channels !== 1) || feedIds.length > 1) throw new Error("feed-identity-unqualified");
  return Object.freeze({ format, ...(feedIds.length === 1 ? { nativeFeedId: feedIds[0] } : {}),
    declaredSelfUrls: Object.freeze(selfUrls), membership: "complete-document", filteredCount: 0, truncated: false,
    entries: Object.freeze(entries) });
}
