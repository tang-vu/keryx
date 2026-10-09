import { describe, expect, it } from "vitest";
import { PAPER_CATALOG } from "../papers/catalog";
import { saveLiteraturePaper } from "../papers/literature-workspace";
import { buildEvidenceDraft, evidenceDraftWorkspace, MAX_EVIDENCE_DRAFT_BYTES, parseEvidenceDraftRequest, replaceEvidenceDraftTheme } from "./evidence-draft";
import { exportEvidenceDraft, rekeyDraftBibtex } from "./evidence-draft-export";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { evidenceDraftTool } from "./evidence-draft-tool";

describe("private retained-evidence drafts", () => {
  it("projects only Include bibliography/focus while omitting screening notes", () => {
    const input = evidenceDraftFixture(); input.workspace.entries[0].notes = "PRIVATE SCREENING NOTES";
    input.workspace = saveLiteraturePaper(input.workspace, PAPER_CATALOG[1], "2026-10-09T00:00:00.000Z");
    const result = evidenceDraftWorkspace(input.workspace);
    expect(result.entries).toHaveLength(1); expect(result.entries[0].notes).toBe("");
    expect(input.workspace.entries[0].notes).toBe("PRIVATE SCREENING NOTES");
  });
  it("keeps draft keys independent of old ordered and coordinated stable bibliography headers", () => {
    for (const upstreamKey of ["keryxPaper1", "keryxPaperabcdef0123456789"]) {
      const raw = `@misc{${upstreamKey},\n  title = {Literal keryxPaper1 key text}\n}\n`;
      expect(rekeyDraftBibtex(raw, "keryxDraftabc123")).toBe("@misc{keryxDraftabc123,\n  title = {Literal keryxPaper1 key text}\n}\n");
    }
    expect(() => rekeyDraftBibtex("not an entry", "keryxDraftabc123")).toThrow();
  });
  it("assembles exact retained ledger excerpts without promoting support or authenticating origin", () => {
    const input = evidenceDraftFixture(), result = buildEvidenceDraft(input);
    expect(result.excerpts).toHaveLength(1); expect(result.origin).toBe("caller-supplied-report");
    expect(result.claims[0]).toMatchObject({ text: input.passage, status: "assessment-pending", excerpts: [] });
    expect(result.claims[0]).not.toHaveProperty("assessment"); expect(result.references).toEqual([]);
    expect(result.notice).toContain("settlement are not authenticated");
  });
  it("requires exact marker/source/item/URL/version and original claim identity, never same-title substitution", () => {
    for (const changes of [{ marker: "S2" }, { sourceId: "other" }, { itemId: "other" },
      { itemUrl: "https://arxiv.org/abs/2601.00001v99" }, { contentVersion: "changed" }, { claim: "Changed target" }]) {
      const input = evidenceDraftFixture(); Object.assign(input.reports[0].evidence![0], changes);
      expect(buildEvidenceDraft(input).excerpts).toEqual([]);
      expect(buildEvidenceDraft(input).claims[0].status).toBe("source-unavailable");
    }
  });
  it("refuses unknown and version-changed selected excerpts instead of silently substituting new content", () => {
    const input = evidenceDraftFixture(), excerpt = buildEvidenceDraft(input).excerpts[0];
    input.themes[0].excerptIds = [excerpt.id]; input.reports[0].evidence![0].quote = "A changed quote from another passage.";
    expect(() => buildEvidenceDraft(input)).toThrow("unavailable or changed");
  });
  it("does not use synthetic markers, seed fingerprints, duplicate markers, empty quotes or unqualified/legacy rows", () => {
    for (const mutation of ["synthetic-citation", "synthetic-evidence", "duplicate-marker", "empty", "unqualified", "no-version", "no-item", "no-ledger"]) {
      const input = evidenceDraftFixture(), report = input.reports[0];
      if (mutation === "synthetic-citation") report.citations[0].evidenceProvenance = "synthetic-demo";
      if (mutation === "synthetic-evidence") report.evidence![0].evidenceProvenance = "synthetic-demo";
      if (mutation === "duplicate-marker") report.citations.push({ ...report.citations[0] });
      if (mutation === "empty") report.evidence![0].quote = " ";
      if (mutation === "unqualified") Object.assign(report.evidence![0], { qualifiesForAnswer: false, qualifiesForReward: true });
      if (mutation === "no-version") delete report.evidence![0].contentVersion;
      if (mutation === "no-item") delete report.evidence![0].itemId;
      if (mutation === "no-ledger") delete report.evidence;
      expect(buildEvidenceDraft(input).excerpts, mutation).toEqual([]);
    }
  });
  it("keeps excluded/unscreened records unread and rejects cross-paper claim attachments", () => {
    const input = evidenceDraftFixture(), excerpt = buildEvidenceDraft(input).excerpts[0];
    input.claims[0].excerptIds = [excerpt.id]; input.claims[0].paperUrls = ["https://arxiv.org/abs/2601.00001v99"];
    expect(() => buildEvidenceDraft(input)).toThrow("different exact work");
    input.claims = []; input.workspace.entries[0].screening = "exclude";
    expect(buildEvidenceDraft(input).excerpts).toEqual([]); expect(buildEvidenceDraft(input).unread).toEqual([]);
  });
  it("binds an explicit user assessment to literal claim, cited works and exact excerpt rows", () => {
    const input = evidenceDraftFixture(), excerpt = buildEvidenceDraft(input).excerpts[0];
    input.claims[0].excerptIds = [excerpt.id]; input.claims[0].assessment = {
      origin: "user-assessment", reviewer: "Researcher", reviewedAt: "2026-10-09T00:00:00.000Z", verdict: "partly-supported",
      claimText: input.passage, paperUrls: [...input.claims[0].paperUrls], excerptIds: [excerpt.id], excerpts: [excerpt],
    };
    expect(buildEvidenceDraft(input).claims[0].status).toBe("user-assessed");
    expect(buildEvidenceDraft(input).claims[0].assessment?.origin).toBe("user-assessment");
    input.claims[0].assessment.excerpts[0].quote = "Forged replacement";
    expect(buildEvidenceDraft(input).claims[0]).toMatchObject({ status: "assessment-pending", assessmentStale: true });
  });
  it("never applies not-found to absent source evidence and never treats no selected passage as an automatic verdict", () => {
    const input = evidenceDraftFixture(); input.claims[0].assessment = {
      origin: "user-assessment", reviewer: "Researcher", reviewedAt: "2026-10-09T00:00:00.000Z", verdict: "not-found",
      claimText: input.passage, paperUrls: [...input.claims[0].paperUrls], excerptIds: [], excerpts: [],
    };
    expect(buildEvidenceDraft(input).claims[0].status).toBe("user-assessed");
    input.reports = []; const claim = buildEvidenceDraft(input).claims[0];
    expect(claim.status).toBe("source-unavailable"); expect(claim).not.toHaveProperty("assessment");
    expect(claim.evidenceNotice).toContain("not an exhaustive search");
  });
  it("preserves unrelated theme edits when replacing one theme", () => {
    const input = evidenceDraftFixture(); input.themes.push({ id: "theme2", title: "Gaps", authorNote: "My edited paragraph", excerptIds: [] });
    const next = replaceEvidenceDraftTheme(input, { ...input.themes[0], title: "New selection" });
    expect(next.themes[1]).toEqual(input.themes[1]); expect(input.themes[0].title).toBe("Methods");
    expect(() => replaceEvidenceDraftTheme(input, { ...input.themes[0], id: "missing" })).toThrow();
  });
  it("exports citation/reference parity, working stable keys, unread lists and literal safe text", () => {
    const input = evidenceDraftFixture(), excerpt = buildEvidenceDraft(input).excerpts[0]; input.themes[0].excerptIds = [excerpt.id];
    input.themes[0].authorNote = "<script>alert(1)</script>\n\\input{private}%";
    const second = PAPER_CATALOG[1]; input.workspace = saveLiteraturePaper(input.workspace, second, "2026-10-09T00:00:00.000Z"); input.workspace.entries[1].screening = "include";
    const draft = buildEvidenceDraft(input), exports = exportEvidenceDraft(input), key = draft.references[0].key;
    expect(exports.referenceCount).toBe(1); expect(exports.bibtex).toContain(`{${key},`);
    expect(exports.latex).toContain(`\\autocite{${key}}`); expect(exports.latex).toContain(`\\label{${excerpt.id}}`);
    expect(exports.markdown).toContain(`[@${key}]`); expect(exports.markdown).toContain(`id="${excerpt.id}"`);
    expect(exports.ris.match(/^TY  - /gm)).toHaveLength(1); expect(exports.ris).toContain(`UR  - ${excerpt.paperUrl}`);
    expect(exports.markdown).not.toContain("<script>"); expect(exports.latex).not.toContain("\\input{private}");
    expect(exports.markdown).toContain(`${second.title}: retained excerpt unavailable; not described.`);
  });
  it("preserves multiline retained quote text as quotation lines in Markdown", () => {
    const input = evidenceDraftFixture(); input.reports[0].evidence![0].quote = "First retained line.\nSecond retained line.";
    input.themes[0].excerptIds = [buildEvidenceDraft(input).excerpts[0].id];
    expect(exportEvidenceDraft(input).markdown).toContain("> First retained line.\n> Second retained line.");
  });
  it("validates byte, shape, duplicate, Unicode and exact-span limits without evaluating accessors", () => {
    const input = evidenceDraftFixture();
    for (const invalid of [{ ...input, scope: "public" }, { ...input, claims: [{ ...input.claims[0], end: 99999 }] },
      { ...input, reports: [input.reports[0], input.reports[0]] }, { ...input, passage: "\ud800" }, { ...input, secrets: "no" }])
      expect(() => parseEvidenceDraftRequest(invalid)).toThrow();
    let evaluated = false; const accessor = { get passage() { evaluated = true; return "private"; } };
    expect(() => parseEvidenceDraftRequest(accessor)).toThrow(); expect(evaluated).toBe(false);
    expect(() => parseEvidenceDraftRequest({ ...input, passage: "x".repeat(MAX_EVIDENCE_DRAFT_BYTES) })).toThrow();
  });
  it("shares the pure MCP result and emits fixed errors without leaking private input", () => {
    const input = evidenceDraftFixture(); const result = evidenceDraftTool({ draft: input });
    expect("structuredContent" in result && result.structuredContent?.draft).toEqual(buildEvidenceDraft(input));
    const refused = evidenceDraftTool({ draft: { passage: "SECRET_PRIVATE_PASSAGE" } });
    expect(refused).toHaveProperty("isError", true); expect(JSON.stringify(refused)).not.toContain("SECRET_PRIVATE_PASSAGE");
  });
});
