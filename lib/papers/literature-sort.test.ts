import { expect, it } from "vitest";
import { PAPER_CATALOG } from "./catalog";
import { sortLiteratureEntries } from "./literature-sort";
import { emptyLiteratureWorkspace, saveLiteraturePaper, type LiteratureEntry } from "./literature-workspace";

function saved(title: string, year?: number, savedAt = "2026-10-20T00:00:00Z"): LiteratureEntry {
  const entry = saveLiteraturePaper(emptyLiteratureWorkspace(), PAPER_CATALOG[0], savedAt).entries[0];
  return { ...entry, paper: { ...entry.paper, title, publishedYear: year }, notes: "Private unchanged notes" };
}

it("keeps default saved order, source object identities and original private data unchanged", () => {
  const entries = [saved("Zebra", 2024), saved("Alpha", 2020)], raw = JSON.stringify(entries);
  Object.freeze(entries); entries.forEach(entry => { Object.freeze(entry.paper); Object.freeze(entry); });
  const result = sortLiteratureEntries(entries, "saved");
  expect(result).toEqual(entries); expect(result).not.toBe(entries);
  expect(result[0]).toBe(entries[0]); expect(result[1]).toBe(entries[1]);
  expect(sortLiteratureEntries(entries, "title")).toEqual([entries[1], entries[0]]);
  expect(JSON.stringify(entries)).toBe(raw);
});

it("orders title numbers naturally, ignores case/Latin accents and keeps equal-title versions separate", () => {
  const entries = [saved("Alpha 10"), saved("Álpha 2"), saved("alpha 2"), saved("Zebra")];
  entries[2].paper = { ...entries[2].paper, url: "https://arxiv.org/abs/1234.56789v99", arxivId: "1234.56789v99" };
  const sorted = sortLiteratureEntries(entries, "title");
  expect(sorted).toEqual([entries[1], entries[2], entries[0], entries[3]]);
  expect(sorted[0]).toBe(entries[1]); expect(sorted[1].paper.url).toBe(entries[2].paper.url);
});

it("orders recorded publication years newest first, with stable ties and unknown years last", () => {
  const entries = [saved("Unknown"), saved("Older", 2020), saved("New A", 2024), saved("New B", 2024)];
  expect(sortLiteratureEntries(entries, "year")).toEqual([entries[2], entries[3], entries[1], entries[0]]);
  expect(sortLiteratureEntries([], "year")).toEqual([]);
});

it("sorts by actual save instants and retains original order for equal instants", () => {
  const entries = [saved("First", undefined, "2026-10-20T00:00:00Z"), saved("Later", undefined, "2026-10-21T00:00:00Z"),
    saved("Same later", undefined, "2026-10-21T00:00:00Z")];
  expect(sortLiteratureEntries(entries, "recent")).toEqual([entries[1], entries[2], entries[0]]);
});
