import { expect, it } from "vitest";
import { PAPER_CATALOG } from "./catalog";
import { searchLiteratureEntries } from "./literature-search";
import { emptyLiteratureWorkspace, saveLiteraturePaper, type LiteratureEntry } from "./literature-workspace";

const saved = (): LiteratureEntry => saveLiteraturePaper(emptyLiteratureWorkspace(), PAPER_CATALOG[0], "2026-10-20T00:00:00Z").entries[0];

it("keeps original order and object identities without changing saved metadata or notes", () => {
  const entries = [saved(), saved()]; entries[1].notes = "Second note";
  const before = JSON.stringify(entries), results = searchLiteratureEntries(entries, " \t\n ");
  expect(results).toEqual(entries);
  expect(results[0]).toBe(entries[0]); expect(results[1]).toBe(entries[1]);
  expect(JSON.stringify(entries)).toBe(before);
});

it("requires every word across saved metadata and notes, in any order and with Latin accent folding", () => {
  const entry = saved(); entry.paper.title = "Méthodes robustes"; entry.paper.authors = ["José Đặng"];
  entry.notes = "Đường truyền cần kiểm tra";
  for (const query of ["kiem JOSE robustes", "ĐẶNG méthodes", "truyen duong", "robustes\n cần\tJosé"])
    expect(searchLiteratureEntries([entry], query)).toEqual([entry]);
  expect(searchLiteratureEntries([entry], "robustes missing")).toEqual([]);
});

it.each(["日本語の資料", "Кириллица", "عَلَم"])("retains meaningful characters in %s", text => {
  const entry = saved(); entry.notes = text;
  expect(searchLiteratureEntries([entry], text)).toEqual([entry]);
  if (text === "عَلَم") expect(searchLiteratureEntries([entry], "علم")).toEqual([]);
});

it("searches observed identifiers, year, venue and saved links", () => {
  const entry = saved(); entry.paper.doi = "10.5555/example"; entry.paper.publishedYear = 2024; entry.paper.venue = "Example Conference";
  for (const query of ["10.5555/example", entry.paper.arxivId!, "2024 conference", entry.paper.url, entry.paper.metadataUrl,
    ...(entry.paper.links ?? []).map(link => link.url)]) expect(searchLiteratureEntries([entry], query)).toEqual([entry]);
});

it("keeps exact arXiv versions separate rather than grouping matching titles", () => {
  const first = saved(), second = saved();
  const base = first.paper.arxivId!.replace(/v\d+$/, "");
  second.paper = { ...second.paper, arxivId: `${base}v99`, url: `https://arxiv.org/abs/${base}v99`,
    metadataUrl: `https://export.arxiv.org/api/query?id_list=${base}v99`, links: [] };
  expect(searchLiteratureEntries([first, second], base)).toEqual([first, second]);
  expect(searchLiteratureEntries([first, second], `${base}v99`)).toEqual([second]);
});

it("handles omitted optional fields and treats punctuation as literal text", () => {
  const entry = saved(); entry.paper = { ...entry.paper, title: "Bounded record", authors: [], authorCount: 0, authorsTruncated: false,
    links: undefined, doi: undefined, venue: undefined, publishedYear: undefined };
  expect(searchLiteratureEntries([entry], ".*")).toEqual([]);
  expect(searchLiteratureEntries([entry], "bounded")).toEqual([entry]);
  entry.screening = "include";
  expect(searchLiteratureEntries([entry], "include")).toEqual([]);
  expect(searchLiteratureEntries([], "anything")).toEqual([]);
});
