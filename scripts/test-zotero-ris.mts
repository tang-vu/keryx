/** Pinned upstream RIS parser compatibility, not a Zotero desktop/application test. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildCitationExport } from "../lib/research-citation-export";
import type { Citation, ScholarlyMetadata } from "../lib/types";

const translatorPath = process.argv[2];
assert(translatorPath, "Usage: node --import tsx scripts/test-zotero-ris.mts <pinned RIS.js>");
// zotero/translators c7551c1a4d5b9623273119c7fbadf8735731dc92; downloaded separately.
const translator = readFileSync(translatorPath);
assert.equal(createHash("sha256").update(translator).digest("hex"),
  "1011694cf9459553ae019fe09c4bbb0b27ad57d739f22bd25cba0ca64d624554", "Upstream parser bytes changed");
const source = translator.toString("utf8").replace(/^\{[\s\S]*?\n\}\s*/, "");

class ImportedItem {
  creators: unknown[] = [];
  notes: { note: string }[] = [];
  tags: unknown[] = [];
  attachments: unknown[] = [];
  title?: string;
  url?: string;
  archiveLocation?: string;
  constructor(public itemType: string) {}
  complete() {}
}

async function importRis(content: string): Promise<ImportedItem[]> {
  const lines = content.split(/\r?\n/), items: ImportedItem[] = [];
  class Item extends ImportedItem {
    override complete() { items.push(this); }
  }
  // Minimal host for these fixtures: no authors/dates/DOI, plain scalar fields.
  // Type selection, RIS reading, note handling and accession mapping run upstream.
  // Field validity and HTML entity decoding outside N1 are not assessed here.
  const utilities = { fieldIsValidForType: () => true,
    deepCopy: (value: unknown) => JSON.parse(JSON.stringify(value)),
    unescapeHTML: (value: string) => value };
  const context = vm.createContext({ Zotero: { read: () => lines.length ? lines.shift() : false,
    Item, Utilities: utilities }, ZU: utilities });
  vm.runInContext(source, context, { timeout: 1000 });
  await vm.runInContext("doImport()", context, { timeout: 1000 });
  return items;
}

const metadata: ScholarlyMetadata = { provider: "arxiv", recordUrl: "https://export.arxiv.org/api/query",
  retrievedAt: "2026-10-07T00:00:00Z", title: "Recorded preprint", authors: [], workType: "preprint",
  arxivId: "1706.03762v7", peerReview: "unknown", evidenceScope: "abstract-page" };
const preprint: Citation = { marker: "P1", sourceId: "public:arxiv", sourceKind: "public-reference",
  sourceName: 'Source <img src="https://tracker.invalid/pixel"> & research', itemId: "paper-v7",
  itemTitle: "Recorded preprint", itemUrl: "https://arxiv.org/abs/1706.03762v7", contentVersion: "v7",
  weight: 0, reward: 0, rationale: "Recorded public read", scholarly: metadata };
const ris = buildCitationExport([preprint], "ris").content;
const [imported] = await importRis(ris);
assert.equal(imported.itemType, "manuscript");
assert.equal(imported.title, preprint.itemTitle);
assert.equal(imported.url, preprint.itemUrl);
assert.equal(imported.archiveLocation, "arXiv:1706.03762v7");
const notes = imported.notes.map(note => note.note).join("\n");
assert.match(notes, /Read scope: abstract-page\. Preprint\. Peer review unknown/);
assert.match(notes, /Content version: v7\./);
assert.match(notes, /Source &lt;img/); assert.match(notes, /&amp; research/);
assert.doesNotMatch(notes, /<img\b/i);

// Controls prove the old tag silently defaults to a journal article in this parser.
const [legacy] = await importRis(ris.replace("TY  - MANSCPT", "TY  - UNPB"));
assert.equal(legacy.itemType, "journalArticle");
for (const [citation, type] of [
  [{ ...preprint, sourceName: "Publisher", scholarly: { ...metadata, workType: "journal-article" as const } }, "journalArticle"],
  [{ ...preprint, sourceName: "Publisher", scholarly: undefined }, "webpage"],
] as const) {
  const [item] = await importRis(buildCitationExport([citation], "ris").content);
  assert.equal(item.itemType, type);
}
console.log("PASS pinned Zotero RIS parser: manuscript/article/web types, exact arXiv version, literal N1 notes and read limitations; no application/network/provider/payment execution.");
