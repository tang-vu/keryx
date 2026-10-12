import { describe, expect, it } from "vitest";
import { assembleEvidenceDraftRequest, buildEvidenceDraft } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { evidenceDraftTool } from "./evidence-draft-tool";
import { createEvidenceDraftRoute } from "./evidence-draft-route";
import { PAPER_CATALOG } from "../papers/catalog";
import { saveLiteraturePaper } from "../papers/literature-workspace";
import { relatedWorkReadingDraft } from "./related-work-generation";

describe("retained extractive related-work assembly", () => {
  it("appends cited literal contributions without inferring comparisons or overwriting author edits", () => {
    const input = evidenceDraftFixture(), before = structuredClone(input);
    const next = assembleEvidenceDraftRequest(input, { mode: "append" }), draft = buildEvidenceDraft(next);
    expect(input).toEqual(before); expect(next.themes[0]).toEqual(before.themes[0]); expect(next.themes).toHaveLength(2);
    const statement = draft.themes[1].statements[0], excerpt = draft.excerpts[0];
    expect(statement).toMatchObject({ kind: "contribution", status: "excerpt-bound", paperUrls: [excerpt.paperUrl], excerptIds: [excerpt.id],
      text: `The retained excerpt states: “${excerpt.quote}”` });
    expect(next.themes[1].title).toBe(input.reports[0].subClaims[0]);
    expect(assembleEvidenceDraftRequest(next, { mode: "append" })).toEqual(next);
    const exports = exportEvidenceDraft(next), key = draft.references[0].key;
    expect(exports.referenceCount).toBe(1); expect(exports.markdown).toContain(`[@${key}]`);
    expect(exports.latex).toContain(`\\autocite{${key}}`); expect(exports.bibtex).toContain(`{${key},`);
    expect(exports.ris).toContain(`UR  - ${excerpt.paperUrl}`);
    expect(statement.text).not.toContain("every possible task");
  });

  it("uses Include evidence only and never substitutes another version or bibliographic title", () => {
    const input = evidenceDraftFixture(); input.workspace.entries[0].screening = "exclude";
    expect(assembleEvidenceDraftRequest(input, { mode: "append" }).themes).toEqual(input.themes);
    input.workspace.entries[0].screening = "include";
    input.reports[0].citations[0].contentVersion = "other-version";
    expect(assembleEvidenceDraftRequest(input, { mode: "append" }).themes).toEqual(input.themes);
    expect(exportEvidenceDraft({ ...input, assembly: { mode: "append" } }).referenceCount).toBe(0);
  });

  it("keeps bounded topic labels well-formed even at a UTF-16 boundary or with an empty original target", () => {
    const input = evidenceDraftFixture();
    for (const target of ["x".repeat(119) + "😀", "😀".repeat(100), ""]) {
      input.reports[0].subClaims[0] = target; input.reports[0].evidence![0].claim = target;
      const next = assembleEvidenceDraftRequest(input, { mode: "append" });
      expect(next.themes[1].title.length).toBeLessThanOrEqual(120);
      expect(next.themes[1].title.isWellFormed()).toBe(true); expect(next.themes[1].title.trim()).not.toBe("");
    }
  });

  it("regenerates the selected theme's sentences while preserving notes, titles, passage and other edits", () => {
    const input = assembleEvidenceDraftRequest(evidenceDraftFixture(), { mode: "append" });
    input.themes[0].authorNote = "Keep unrelated author edits";
    input.themes[0].statements = [{ id: "authorGap", kind: "gap", text: "An author question to keep", paperUrls: [], excerptIds: [] }];
    input.themes[1].authorNote = "Keep this theme's notes"; input.themes[1].title = "My theme title";
    input.themes[1].statements![0].text = "My editable sentence";
    const before = structuredClone(input), target = input.themes[1].id;
    const next = assembleEvidenceDraftRequest(input, { mode: "regenerate", themeId: target });
    expect(next.themes[0]).toEqual(before.themes[0]); expect(next.themes[1].title).toBe(before.themes[1].title);
    expect(next.themes[1].authorNote).toBe(before.themes[1].authorNote);
    expect(next.passage).toBe(before.passage); expect(next.claims).toEqual(before.claims);
    expect(next.themes[1].statements![0].text).toContain(input.reports[0].evidence![0].quote);
    expect(input).toEqual(before); expect(next.assembly).toBeUndefined();
    next.themes[1].statements![0].text = "Later in-place edit";
    expect(exportEvidenceDraft(next).markdown).toContain("Later in-place edit");
  });

  it("refuses unknown, empty, stale and oversized operations without mutating inputs", () => {
    const input = evidenceDraftFixture(), before = structuredClone(input);
    expect(() => assembleEvidenceDraftRequest(input, { mode: "regenerate", themeId: "missing" })).toThrow("Unknown theme");
    expect(() => assembleEvidenceDraftRequest(input, { mode: "regenerate", themeId: "theme1" })).toThrow("one to 24");
    expect(input).toEqual(before);
    const next = assembleEvidenceDraftRequest(input, { mode: "append" });
    next.reports[0].evidence![0].quote = "Changed retained bytes";
    expect(() => assembleEvidenceDraftRequest(next, { mode: "regenerate", themeId: next.themes[1].id })).toThrow("unavailable or changed");
    const full = evidenceDraftFixture(); full.themes = Array.from({ length: 16 }, (_, index) => ({ ...full.themes[0], id: `theme${index}` }));
    expect(() => assembleEvidenceDraftRequest(full, { mode: "append" })).toThrow("Too many retained themes");
    expect(() => buildEvidenceDraft({ ...input, assembly: { mode: "regenerate" } })).toThrow();
    expect(() => buildEvidenceDraft({ ...input, assembly: { mode: "append", themeId: "theme1" } })).toThrow();
  });

  it("keeps generated keys and anchors stable across export formats and unchanged rebuilds", () => {
    const input = evidenceDraftFixture(), value = { ...input, assembly: { mode: "append" } };
    expect(buildEvidenceDraft(value)).toEqual(buildEvidenceDraft(value));
    const result = evidenceDraftTool({ draft: value });
    expect(result).not.toHaveProperty("isError");
    if ("structuredContent" in result && result.structuredContent) expect(result.structuredContent.exports.referenceCount).toBe(1);
  });

  it("reuses the authenticated bounded route and fixed failure response", async () => {
    const route = createEvidenceDraftRoute(async () => null), input = evidenceDraftFixture();
    const send = (draft: unknown) => route(new Request("https://keryx.cc/api/research/evidence-draft", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    }));
    const response = await send({ ...input, assembly: { mode: "append" } });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json(); expect(body.exports.referenceCount).toBe(1);
    expect(body.draft.editableRequest.assembly).toBeUndefined();
    body.draft.editableRequest.themes[1].statements[0].text = "Keep my API edit";
    expect(exportEvidenceDraft(body.draft.editableRequest).markdown).toContain("Keep my API edit");
    const rejected = await send({ ...input, assembly: { mode: "regenerate", themeId: "PRIVATE_UNKNOWN_THEME" } });
    expect(rejected.status).toBe(400); expect(await rejected.text()).not.toContain("PRIVATE_UNKNOWN_THEME");
  });

  it("appends all newly available included records without duplicating already organised evidence", () => {
    const input = assembleEvidenceDraftRequest(evidenceDraftFixture(), { mode: "append" }), other = PAPER_CATALOG[1];
    input.workspace = saveLiteraturePaper(input.workspace, other, "2026-10-12T00:00:00.000Z"); input.workspace.entries[1].screening = "include";
    const report = structuredClone(input.reports[0]); report.id = "retained2";
    for (const row of [...report.citations, ...report.evidence!]) Object.assign(row, { itemUrl: other.url, itemId: "other-paper" });
    input.reports.push(report);
    const next = assembleEvidenceDraftRequest(input, { mode: "append" });
    expect(next.themes.slice(0, 2)).toEqual(input.themes); expect(buildEvidenceDraft(next).references).toHaveLength(2);
  });

  it("prepares only exact Include reading requests under the existing limit without sending notes", () => {
    const input = evidenceDraftFixture(), row = input.workspace.entries[0]; row.notes = "PRIVATE_REVIEW_NOTES";
    const question = relatedWorkReadingDraft(input.workspace, row.paper.url);
    expect(question).toContain(row.paper.url); expect(question).toContain(input.workspace.question);
    expect(question).not.toContain(row.notes); expect(question).not.toContain(row.paper.title);
    expect(question).toContain("normal budget, BUY/SKIP/CACHE reasons");
    expect(() => relatedWorkReadingDraft(input.workspace, "https://arxiv.org/abs/0000.00000v99")).toThrow("exact Include record");
    row.screening = "exclude"; expect(() => relatedWorkReadingDraft(input.workspace, row.paper.url)).toThrow("exact Include record");
    row.screening = "include"; input.workspace.question = "q".repeat(2000);
    expect(() => relatedWorkReadingDraft(input.workspace, row.paper.url)).toThrow("question limit");
  });
});
