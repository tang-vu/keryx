import { describe, expect, it } from "vitest";
import { buildEvidenceDraft } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { PAPER_CATALOG } from "../papers/catalog";
import { saveLiteraturePaper } from "../papers/literature-workspace";

describe("related-work reading observations", () => {
  const fixture = () => {
    const input = evidenceDraftFixture(); input.reports = []; input.claims = [];
    for (const paper of PAPER_CATALOG.slice(1, 3)) input.workspace = saveLiteraturePaper(input.workspace, paper, "2026-10-12T00:00:00.000Z");
    for (const row of input.workspace.entries) row.screening = "include";
    return input;
  };
  it("separates explicit unread, unavailable and unknown statuses without describing or citing them", () => {
    const input = fixture(), [one, two, three] = input.workspace.entries;
    input.readingStatuses = [{ paperUrl: one.paper.url, status: "unread", reason: "Not attempted" },
      { paperUrl: two.paper.url, status: "unavailable", reason: "My attempted exact link required publisher verification" }];
    const draft = buildEvidenceDraft(input), exports = exportEvidenceDraft(input);
    expect(draft.reading.unread.map(row => row.paper.url)).toEqual([one.paper.url]);
    expect(draft.reading.unavailable.map(row => row.paper.url)).toEqual([two.paper.url]);
    expect(draft.reading.unknown.map(row => row.paper.url)).toEqual([three.paper.url]);
    expect(draft.references).toEqual([]); expect(exports.bibtex).toBe(""); expect(exports.ris).toBe("");
    expect(exports.markdown).toContain("## Unread papers (caller observation)");
    expect(exports.markdown).toContain("## Unavailable papers (caller observation)");
    expect(exports.latex).toContain("\\subsection{Unread papers (caller observation)}");
    expect(exports.markdown).toContain("not read; not described. Reason: Not attempted");
    expect(exports.markdown).toContain("unavailable; not described.");
  });
  it("keeps legacy retention gaps unknown rather than claiming a paper was never read", () => {
    const input = fixture(), draft = buildEvidenceDraft(input);
    expect(draft.reading.unknown).toHaveLength(3); expect(draft.reading.unread).toEqual([]); expect(draft.reading.unavailable).toEqual([]);
    expect(draft.unread).toHaveLength(3); // Retained v1 compatibility field; not an original-access observation.
  });
  it("rejects contradictory retained evidence, duplicate, excluded and alternate-version observations", () => {
    const input = evidenceDraftFixture(), url = input.workspace.entries[0].paper.url;
    input.readingStatuses = [{ paperUrl: url, status: "unavailable", reason: "Unverified caller observation" }];
    expect(() => buildEvidenceDraft(input)).toThrow("conflicts with retained evidence");
    input.reports = []; input.readingStatuses.push({ ...input.readingStatuses[0] });
    expect(() => buildEvidenceDraft(input)).toThrow("Duplicate reading dispositions");
    input.readingStatuses.pop(); input.workspace.entries[0].screening = "exclude";
    expect(() => buildEvidenceDraft(input)).toThrow("exact Include record");
    input.workspace.entries[0].screening = "include"; input.readingStatuses[0].paperUrl = "https://arxiv.org/abs/0000.00000v99";
    expect(() => buildEvidenceDraft(input)).toThrow("exact Include record");
  });
  it("bounds and escapes observations so they cannot introduce citations, HTML or LaTeX commands", () => {
    const input = fixture(), url = input.workspace.entries[0].paper.url;
    input.readingStatuses = [{ paperUrl: url, status: "unavailable", reason: "[@injected] <script> \\autocite{injected}" }];
    const exports = exportEvidenceDraft(input);
    expect(exports.referenceCount).toBe(0); expect(exports.markdown).toContain("\\[\\@injected\\]");
    expect(exports.latex).not.toContain("\\autocite{injected}");
    input.readingStatuses[0].reason = "x".repeat(301); expect(() => buildEvidenceDraft(input)).toThrow();
  });
});
