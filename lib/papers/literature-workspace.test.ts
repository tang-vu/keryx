import { describe, expect, it } from "vitest";
import { PAPER_CATALOG } from "./catalog";
import { emptyLiteratureWorkspace, literatureComparisonDraft, literatureScreeningCsv, MAX_LITERATURE_BYTES,
  parseLiteratureWorkspace, saveLiteraturePaper, serializeLiteratureWorkspace } from "./literature-workspace";

const time = "2026-10-07T00:00:00.000Z";
const first = PAPER_CATALOG[0], second = PAPER_CATALOG[1];
const saved = () => saveLiteraturePaper(saveLiteraturePaper(emptyLiteratureWorkspace(), first, time), second, time);

describe("personal literature workspace", () => {
  it("preserves the first exact snapshot and distinct arXiv versions, without grouping by title", () => {
    const workspace = saveLiteraturePaper(emptyLiteratureWorkspace(), first, time);
    workspace.entries[0].notes = "Keep this screening work";
    const refreshed = { ...first, title: "Refreshed title", metadataObservedAt: "2026-10-08T00:00:00.000Z" };
    expect(saveLiteraturePaper(workspace, refreshed, time)).toBe(workspace);
    const arxivId = first.arxivId!.replace(/v\d+$/, "v99");
    const version = { ...first, arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` };
    const result = saveLiteraturePaper(workspace, version, time);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ notes: "Keep this screening work", paper: first });
  });
  it("round trips focus, exact records, decisions and Unicode notes without adding read or payment fields", () => {
    const workspace = saved(); workspace.title = "Review 📚"; workspace.question = "Phương pháp nào phù hợp?";
    workspace.entries[1].screening = "exclude"; workspace.entries[1].notes = "Not our population\nNeeds checking";
    expect(parseLiteratureWorkspace(serializeLiteratureWorkspace(workspace))).toEqual(workspace);
  });
  it("refuses malformed, future, duplicate, oversized and nonbibliographic backups", () => {
    const workspace = saved();
    for (const value of ["{broken", JSON.stringify({ ...workspace, version: 2 }),
      JSON.stringify({ ...workspace, entries: [workspace.entries[0], workspace.entries[0]] }),
      JSON.stringify({ ...workspace, payments: [{ settled: true }] }),
      JSON.stringify({ ...workspace, entries: [{ ...workspace.entries[0], paper: { ...first, url: "javascript:alert(1)" } }] }),
      JSON.stringify({ ...workspace, entries: [{ ...workspace.entries[0], notes: "x".repeat(2001) }] }),
      `"${"📚".repeat(MAX_LITERATURE_BYTES / 4)}"`]) expect(() => parseLiteratureWorkspace(value)).toThrow();
    expect(saved().entries).toHaveLength(2);
  });
  it("bounds paper count and validates all newly saved records", () => {
    let workspace = emptyLiteratureWorkspace();
    for (let index = 1; index <= 50; index++) {
      const arxivId = `2601.${String(index).padStart(5, "0")}v1`;
      workspace = saveLiteraturePaper(workspace, { ...first, arxivId, url: `https://arxiv.org/abs/${arxivId}`, metadataUrl: `https://export.arxiv.org/api/query?id_list=${arxivId}` }, time);
    }
    expect(() => saveLiteraturePaper(workspace, second, time)).toThrow("50 papers");
    expect(workspace.entries).toHaveLength(50);
    expect(() => saveLiteraturePaper(emptyLiteratureWorkspace(), { ...first, peerReview: "verified" } as never, time)).toThrow();
  });
  it("exports all rows with literal notes, exact identity, missing fields and formula neutralization", () => {
    const workspace = saved(); workspace.title = "=1+1";
    workspace.entries[0].notes = '\u200b@SUM(1,2)\n"note"'; workspace.entries[1].screening = "exclude";
    const csv = literatureScreeningCsv(workspace);
    expect(csv).toContain('"\'=1+1"'); expect(csv).toContain('"\'\u200b@SUM(1,2)\n""note"""');
    expect(csv).toContain('"Exclude"'); expect(csv).toContain(first.arxivId);
    expect(csv).toContain(first.metadataObservedAt); expect(csv).toContain("paper text unread");
    expect(workspace.entries[0].notes).toBe('\u200b@SUM(1,2)\n"note"');
  });
  it("builds only a bounded editable draft from exactly two saved links and deliberate review criteria", () => {
    const workspace = saved(); workspace.question = "Grounding methods"; workspace.entries[0].notes = "PRIVATE SCREENING NOTE";
    const draft = literatureComparisonDraft(workspace, [second.url, first.url]);
    expect(draft).toContain(`on: Grounding methods`); expect(draft).toContain(`${second.url}\n${first.url}`);
    expect(draft).toContain("abstract-only"); expect(draft).not.toContain("PRIVATE SCREENING NOTE");
    for (const urls of [[], [first.url], [first.url, first.url], [first.url, "https://arxiv.org/abs/2601.99999v1"], [first.url, second.url, "extra"]])
      expect(() => literatureComparisonDraft(workspace, urls)).toThrow();
    workspace.entries[0].paper.url = `https://arxiv.org/abs/${"x".repeat(1800)}`;
    expect(() => literatureComparisonDraft(workspace, [workspace.entries[0].paper.url, second.url])).toThrow("question limit");
  });
});
