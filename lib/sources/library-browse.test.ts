import { describe, expect, it } from "vitest";
import { browseLibrary, libraryBrowseHref, libraryPublisherGroups, librarySearchMatches, libraryTopicHints, parseLibraryFilters, type LibraryRecord } from "./library-browse";

const records: LibraryRecord[] = [
  { id: "docs", name: "PostgreSQL", url: "https://www.postgresql.org/docs/", tags: ["database", "SQL"], topic: "data-infrastructure", kind: "explore" },
  { id: "feed", name: "Agent research", url: "https://blog.example.com/", kind: "feed", itemTitles: ["Café model evaluation"], observedAt: "2026-10-04T12:00:00Z" },
  { id: "cited", name: "Idempotent requests", url: "https://docs.example.com/api/", kind: "cited", observedAt: "2026-10-05T12:00:00Z" },
  { id: "creator", name: "Payment creator", url: "", kind: "creator", observedAt: "invalid" },
];
const all = parseLibraryFilters({});

describe("source library browsing", () => {
  it("combines literal title, domain, tag and retained-item search with collection and topic filters", () => {
    expect(browseLibrary(records, { ...all, q: "postgresql SQL", topic: "data-infrastructure", kind: "explore" }).map(row => row.id)).toEqual(["docs"]);
    expect(browseLibrary(records, { ...all, q: "example.com", kind: "cited" }).map(row => row.id)).toEqual(["cited"]);
    expect(browseLibrary(records, { ...all, q: "cafe evaluation" }).map(row => row.id)).toEqual(["feed"]);
    expect(browseLibrary(records, { ...all, q: "missing" })).toEqual([]);
    expect(browseLibrary(records, { ...all, q: "PostgreSQL", topic: "payments" })).toEqual([]);
    expect(librarySearchMatches(records[0], ".* (" )).toBe(false);
  });
  it("bounds untrusted URL input, takes the first duplicate value and refuses inherited keys", () => {
    expect(parseLibraryFilters({ q: ["  Agents  ", "payments"], topic: "__proto__", kind: "constructor", sort: "bad" })).toEqual({ ...all, q: "Agents" });
    expect(parseLibraryFilters({ q: "x".repeat(200), topic: "payments", kind: "feed", sort: "recent" })).toEqual({ q: "x".repeat(120), topic: "payments", kind: "feed", sort: "recent" });
  });
  it("keeps unknown observation dates last and does not mutate the source order", () => {
    expect(browseLibrary(records, { ...all, sort: "recent" }).map(row => row.id)).toEqual(["cited", "feed", "creator", "docs"]);
    expect(browseLibrary(records, { ...all, sort: "name" }).map(row => row.id)).toEqual(["feed", "cited", "creator", "docs"]);
    expect(records.map(row => row.id)).toEqual(["docs", "feed", "cited", "creator"]);
  });
  it("groups subdomains without claiming identity, preserving independently hosted private domains", () => {
    const urls = ["https://blog.example.com/", "https://docs.example.com/a", "https://alice.github.io/", "https://bob.github.io/", "https://user:secret@example.com/", "javascript:alert(1)", "invalid"];
    expect(libraryPublisherGroups(urls.map((url, index) => ({ ...records[0], id: String(index), url })))).toBe(3);
  });
  it("uses bounded metadata hints rather than treating AI substrings or unclassified titles as authority", () => {
    expect(libraryTopicHints({ ...records[0], topic: undefined, name: "SQLite WAL backup" })).toContain("data-infrastructure");
    expect(libraryTopicHints({ id: "other", name: "Daily notes", url: "https://plain.example/", kind: "cited" })).toEqual(["other"]);
    expect(libraryTopicHints({ id: "pay", name: "Paid access", url: "https://plain.example/", kind: "cited" })).not.toContain("ai-agents");
    expect(libraryTopicHints({ ...records[0], topic: "payments" })).toEqual(["payments"]);
  });
  it("preserves a shareable search while changing one filter and never auto-submits research", () => {
    const href = libraryBrowseHref({ ...all, q: "agents & models", kind: "feed" }, { topic: "ai-agents" });
    const url = new URL(href, "https://keryx.cc");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "agents & models", topic: "ai-agents", kind: "feed" });
    expect(url.hash).toBe("#browse-sources");
    expect(url.searchParams.has("run")).toBe(false);
    expect(libraryBrowseHref(all)).toBe("/sources#browse-sources");
  });
});
