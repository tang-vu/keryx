import { expect, it } from "vitest";
import { PAPER_CATALOG } from "./catalog";
import { addMissingLiteraturePapers, previewLiteratureImport, readLiteratureWorkspaceFile } from "./literature-import";
import { emptyLiteratureWorkspace, MAX_LITERATURE_BYTES, saveLiteraturePaper, serializeLiteratureWorkspace } from "./literature-workspace";
import { literatureImportCopy as copy } from "../../locales/en/literature-import";

const time = "2026-10-20T00:00:00Z";
const saved = (...indices: number[]) => indices.reduce((value, index) => saveLiteraturePaper(value, PAPER_CATALOG[index], time), emptyLiteratureWorkspace());
const many = (start: number, count: number, large = false) => {
  const value = emptyLiteratureWorkspace();
  for (let index = start; index < start + count; index++) {
    const arxivId = `2601.${String(index).padStart(5, "0")}v1`;
    value.entries.push({ paper: { ...PAPER_CATALOG[0], arxivId, url: `https://arxiv.org/abs/${arxivId}`,
      metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}`,
      ...(large ? { authors: Array.from({ length: 50 }, () => "界".repeat(300)), authorCount: 50, authorsTruncated: false } : {}) },
    savedAt: time, screening: "unscreened", notes: "" });
  }
  return value;
};

it("previews without mutation and keeps current focus, exact duplicate snapshots, order and saved edits", () => {
  const current = saved(0, 1), incoming = saved(0, 2);
  current.title = "Current review"; current.question = "Current criteria";
  current.entries[0].notes = "Existing note"; current.entries[0].screening = "exclude";
  incoming.title = "Other review"; incoming.question = "Other criteria";
  incoming.entries[0].notes = "Do not overwrite"; incoming.entries[0].paper.title = "New metadata";
  incoming.entries[1].notes = "Imported note 📚"; incoming.entries[1].screening = "include";
  const before = [serializeLiteratureWorkspace(current), serializeLiteratureWorkspace(incoming)];
  expect(previewLiteratureImport(current, incoming)).toEqual({ additions: [incoming.entries[1]], duplicates: 1, total: 3 });
  const combined = addMissingLiteraturePapers(current, incoming);
  expect(combined).toMatchObject({ title: "Current review", question: "Current criteria" });
  expect(combined.entries).toEqual([...current.entries, incoming.entries[1]]);
  expect(combined.entries[0]).toBe(current.entries[0]);
  expect(combined.entries[2]).toBe(incoming.entries[1]);
  expect([serializeLiteratureWorkspace(current), serializeLiteratureWorkspace(incoming)]).toEqual(before);
});

it("retains different arXiv versions even when titles and DOI match", () => {
  const current = saved(0), incoming = saved(0);
  const paper = incoming.entries[0].paper, arxivId = paper.arxivId!.replace(/v\d+$/, "v99");
  Object.assign(paper, { arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` });
  expect(addMissingLiteraturePapers(current, incoming).entries).toHaveLength(2);
});

it("does not replace focus on an empty destination or write a duplicate-only/empty import", () => {
  const current = saved(0), incoming = saved(0); incoming.title = "Not adopted";
  expect(addMissingLiteraturePapers(current, incoming)).toBe(current);
  expect(addMissingLiteraturePapers(current, emptyLiteratureWorkspace())).toBe(current);
  expect(addMissingLiteraturePapers(emptyLiteratureWorkspace(), incoming).title).toBe("");
});

it("refuses an over-capacity union in full, including when both individual files are valid", () => {
  const current = many(1, 49), incoming = many(50, 2), before = serializeLiteratureWorkspace(current);
  expect(previewLiteratureImport(current, incoming).total).toBe(51);
  expect(() => addMissingLiteraturePapers(current, incoming)).toThrow(copy.capacity);
  expect(serializeLiteratureWorkspace(current)).toBe(before);
  expect(addMissingLiteraturePapers(many(1, 50), many(1, 50)).entries).toHaveLength(50);
});

it("bounds combined UTF-8 bytes before any write, despite individually valid files and count", () => {
  const current = many(1, 12, true), incoming = many(13, 12, true);
  expect(() => serializeLiteratureWorkspace(current)).not.toThrow();
  expect(() => serializeLiteratureWorkspace(incoming)).not.toThrow();
  expect(() => addMissingLiteraturePapers(current, incoming)).toThrow("1 MiB");
  expect(current.entries).toHaveLength(12);
});

it("refuses invalid or evidence-bearing input even when all its URLs would be skipped", () => {
  const current = saved(0), incoming = saved(0);
  expect(() => addMissingLiteraturePapers(current, { ...incoming, payments: [] } as never)).toThrow();
  expect(() => addMissingLiteraturePapers(current, { ...incoming, entries: [...incoming.entries, ...incoming.entries] })).toThrow();
  incoming.entries[0].paper.peerReview = "verified" as never;
  expect(() => addMissingLiteraturePapers(current, incoming)).toThrow();
  expect(current.entries[0].paper.peerReview).toBe("unknown");
});

it.each([{ prefix: [] }, { prefix: [0xef, 0xbb, 0xbf] }])("retains exact valid Unicode and literal replacement characters with BOM $prefix", ({ prefix }) => {
  const value = saved(0); value.title = "Tổng quan 📚"; value.entries[0].notes = "e\u0301 · � · العربية · 中文";
  const bytes = Buffer.concat([Buffer.from(prefix), Buffer.from(serializeLiteratureWorkspace(value))]);
  expect(readLiteratureWorkspaceFile(bytes)).toEqual(value);
});

it.each([[0xff], [0xc0, 0xaf], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]].map(invalid => ({ invalid })))(
  "refuses malformed UTF-8 $invalid instead of importing repaired note text", ({ invalid }) => {
    const value = saved(0); value.entries[0].notes = "INVALID_BYTES";
    const [before, after] = serializeLiteratureWorkspace(value).split("INVALID_BYTES");
    const bytes = Buffer.concat([Buffer.from(before), Buffer.from(invalid), Buffer.from(after)]);
    // This file is accepted after the browser's old lossy decode, proving why byte validation matters.
    expect(() => JSON.parse(new TextDecoder().decode(bytes))).not.toThrow();
    expect(() => readLiteratureWorkspaceFile(bytes)).toThrow("backup");
    expect(value.entries[0].notes).toBe("INVALID_BYTES");
  });

it("bounds actual bytes and keeps strict JSON/schema validation after decoding", () => {
  expect(() => readLiteratureWorkspaceFile(new Uint8Array(MAX_LITERATURE_BYTES + 1))).toThrow("1 MiB");
  for (const value of ["{broken", JSON.stringify({ ...saved(0), version: 2 }), JSON.stringify({ ...saved(0), payments: [] })])
    expect(() => readLiteratureWorkspaceFile(new TextEncoder().encode(value))).toThrow();
  expect(() => readLiteratureWorkspaceFile(Buffer.from([0xff, 0xfe, 0x7b, 0x00]))).toThrow();
});
