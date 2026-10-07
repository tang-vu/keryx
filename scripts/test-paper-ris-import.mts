/** Pinned upstream parser under a minimal host; not Zotero application acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { PAPER_CATALOG } from "../lib/papers/catalog";
import { paperReferencesRis } from "../lib/papers/reference-export";
import type { PaperRecord } from "../lib/papers/types";

assert(process.argv[2], "Usage: node --import tsx scripts/test-paper-ris-import.mts <pinned RIS.js>");
const translator = readFileSync(process.argv[2]);
assert.equal(createHash("sha256").update(translator).digest("hex"),
  "1011694cf9459553ae019fe09c4bbb0b27ad57d739f22bd25cba0ca64d624554", "Upstream RIS parser bytes changed");
// zotero/translators c7551c1a4d5b9623273119c7fbadf8735731dc92. Bytes are downloaded separately.
const source = translator.toString("utf8").replace(/^\{[\s\S]*?\n\}\s*/, "");
class ImportedItem {
  creators: { firstName?: string; lastName?: string }[] = [];
  notes: { note: string }[] = [];
  tags: unknown[] = [];
  attachments: unknown[] = [];
  title?: string; url?: string; archiveLocation?: string; date?: string;
  publicationTitle?: string; conferenceName?: string;
  constructor(public itemType: string) {}
  complete() {}
}
async function importRis(content: string) {
  const lines = content.split(/\r?\n/), items: ImportedItem[] = [];
  class Item extends ImportedItem { override complete() { items.push(this); } }
  // Types, record separation, author splitting, year-only dates and note handling
  // execute upstream. The host does not assess Zotero field validity, entity
  // decoding, DOI normalization, attachments or application rendering/import.
  const utilities = { fieldIsValidForType: () => true,
    deepCopy: (value: unknown) => JSON.parse(JSON.stringify(value)),
    unescapeHTML: (value: string) => {
      assert(!/&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(value), "Fixture needs real entity decoding");
      return value;
    } };
  const context = vm.createContext({ Zotero: { read: () => lines.length ? lines.shift() : false,
    Item, Utilities: utilities }, ZU: utilities });
  vm.runInContext(source, context, { timeout: 1000 });
  await vm.runInContext("doImport()", context, { timeout: 1000 });
  return items;
}

const base = PAPER_CATALOG[0];
const { doi: _doi, ...withoutDoi } = base;
const records: PaperRecord[] = Array.from({ length: 4 }, (_, index) => ({ ...withoutDoi,
  arxivId: `2601.00001v${index + 1}`, url: `https://arxiv.org/abs/2601.00001v${index + 1}`,
  title: "Synthetic saved bibliography", authors: ["Example, Ada"], authorCount: 2, authorsTruncated: true,
  publishedYear: 2026, venue: 'Recorded venue <img src="https://tracker.invalid/pixel"> & metadata',
  publicationKind: (["preprint", "conference-paper", "journal-article", "unknown"] as const)[index] }));
const imported = await importRis(paperReferencesRis(records).content);
assert.equal(imported.length, 4);
assert.deepEqual(imported.map(item => item.itemType), ["manuscript", "conferencePaper", "journalArticle", "webpage"]);
for (const [index, item] of imported.entries()) {
  assert.equal(item.title, records[index].title);
  assert.equal(item.url, records[index].url);
  assert.equal(item.archiveLocation, `arXiv:2601.00001v${index + 1}`);
  assert.equal(item.date, "2026");
  assert.equal(item.creators[0].lastName, "Example"); assert.equal(item.creators[0].firstName, "Ada");
  const notes = item.notes.map(note => note.note).join("\n");
  assert.match(notes, /no Keryx read, citation or settlement evidence/);
  assert.match(notes, /Peer review unknown/); assert.match(notes, /Incomplete contributor list: 1\/2/);
  assert.match(notes, /&lt;img/); assert.doesNotMatch(notes, /<img\b/i);
  assert.equal(item.attachments.length, 0);
}
assert.equal(imported[0].publicationTitle, undefined);
assert.equal(imported[1].conferenceName, records[1].venue);
assert.equal(imported[2].publicationTitle, records[2].venue);
console.log("PASS pinned Zotero RIS parser: four observed types, separate exact versions, author/year mapping and literal metadata-only notes. No Zotero application, enrichment or payment execution.");
