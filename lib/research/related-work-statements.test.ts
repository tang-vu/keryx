import { describe, expect, it } from "vitest";
import { PAPER_CATALOG } from "../papers/catalog";
import { saveLiteraturePaper } from "../papers/literature-workspace";
import { buildEvidenceDraft, parseEvidenceDraftRequest, replaceEvidenceDraftTheme, type EvidenceDraftRequest } from "./evidence-draft";
import { exportEvidenceDraft, statementAnchor } from "./evidence-draft-export";
import { assertDraftCitationParity } from "./evidence-draft-parity";
import { evidenceDraftTool } from "./evidence-draft-tool";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { evaluateRelatedWorkDrafts } from "./related-work-evaluation";

const first = PAPER_CATALOG[0], second = PAPER_CATALOG[1];

/** Two Include papers; `read` selects how many have a retained excerpt. Synthetic fixture only. */
function twoPaperFixture(read: 1 | 2 = 2): EvidenceDraftRequest {
  const input = evidenceDraftFixture();
  input.workspace = saveLiteraturePaper(input.workspace, second, "2026-10-09T00:00:00.000Z");
  input.workspace.entries.find(row => row.paper.url === second.url)!.screening = "include";
  if (read === 2) {
    const identity = { sourceId: "original-paper", marker: "S2", itemId: "paper-two-v1", itemUrl: second.url,
      itemTitle: second.title, contentVersion: "sha256:version-two" };
    input.reports[0].citations.push(identity);
    input.reports[0].evidence!.push({ ...identity, claimIndex: 0, claim: "Original research target",
      quote: "The second method was measured on a different benchmark.", qualifiesForAnswer: true, qualifiesForReward: false });
  }
  return input;
}
const excerptOf = (input: EvidenceDraftRequest, url: string) => buildEvidenceDraft(input).excerpts.find(row => row.paperUrl === url)!;
const statement = (changes: Partial<NonNullable<EvidenceDraftRequest["themes"][number]["statements"]>[number]>) =>
  ({ id: "s1", kind: "contribution" as const, text: "The first paper reports an improved outcome.", paperUrls: [] as string[], excerptIds: [] as string[], ...changes });

describe("related-work statements", () => {
  it("leaves an existing draft without statements unchanged apart from an empty list", () => {
    const draft = buildEvidenceDraft(evidenceDraftFixture());
    expect(draft.themes[0].statements).toEqual([]); expect(draft.references).toEqual([]);
  });

  it("exports a sentence about a paper only with a citation and a link to its retained excerpt", () => {
    const input = twoPaperFixture(), excerpt = excerptOf(input, first.url);
    input.themes[0].statements = [statement({ paperUrls: [first.url], excerptIds: [excerpt.id] })];
    const draft = buildEvidenceDraft(input), exports = exportEvidenceDraft(input), key = draft.references[0].key;
    expect(draft.themes[0].statements[0]).toMatchObject({ status: "excerpt-bound", excerpts: [excerpt] });
    expect(draft.references.map(row => row.paper.url)).toEqual([first.url]);
    const anchor = statementAnchor("s1");
    expect(exports.markdown).toContain(`<a id="${anchor}"></a>\n**Contribution.** The first paper reports an improved outcome. [@${key}] — retained excerpts: [1](#${excerpt.id})`);
    expect(exports.markdown).toContain(`<a id="${excerpt.id}"></a>\n> ${excerpt.quote}`);
    expect(exports.latex).toContain(`\\paragraph{Contribution}\\label{${anchor}} The first paper reports an improved outcome. \\autocite{${key}} (retained excerpts: p.~\\pageref{${excerpt.id}})`);
    expect(exports.latex).toContain(`\\label{${excerpt.id}}\n\\begin{quote}`);
    expect(exports.markdown).toContain("whether an excerpt supports the wording is not verified");
  });

  it("withholds a statement about an unread paper and never describes or cites that paper", () => {
    const input = twoPaperFixture(1);
    input.themes[0].statements = [statement({ text: "UNREAD_PAPER_CHARACTERISATION", paperUrls: [second.url] })];
    const draft = buildEvidenceDraft(input), exports = exportEvidenceDraft(input);
    expect(draft.themes[0].statements[0]).toMatchObject({ status: "withheld", withheldReason: "paper-without-selected-excerpt", missingPaperUrls: [second.url] });
    expect(draft.references).toEqual([]); expect(draft.unread.map(row => row.paper.url)).toEqual([second.url]);
    for (const content of [exports.markdown, exports.latex]) {
      expect(content).not.toContain("UNREAD_PAPER_CHARACTERISATION");
      expect(content).toContain("Withheld: 1 author statement is not exported");
    }
    expect(exports.markdown).toContain(`${second.title}: retained excerpt unavailable; not described.`);
    expect(exports.bibtex).toBe(""); expect(exports.ris).toBe("");
  });

  it("withholds a statement when a read paper is cited without selecting its excerpt", () => {
    const input = twoPaperFixture(), excerpt = excerptOf(input, first.url);
    input.themes[0].statements = [statement({ kind: "agreement", paperUrls: [first.url, second.url], excerptIds: [excerpt.id] })];
    const row = buildEvidenceDraft(input).themes[0].statements[0];
    expect(row).toMatchObject({ status: "withheld", withheldReason: "paper-without-selected-excerpt", missingPaperUrls: [second.url] });
    // The selection of a withheld statement cites nothing.
    expect(buildEvidenceDraft(input).references).toEqual([]);
  });

  it("requires one paper for a contribution and at least two for agreement or disagreement", () => {
    const input = twoPaperFixture(), one = excerptOf(input, first.url), two = excerptOf(input, second.url);
    const both = { paperUrls: [first.url, second.url], excerptIds: [one.id, two.id] };
    input.themes[0].statements = [statement({ id: "c2", ...both }), statement({ id: "a1", kind: "agreement", paperUrls: [first.url], excerptIds: [one.id] }),
      statement({ id: "d2", kind: "disagreement", ...both }), statement({ id: "c0" })];
    expect(buildEvidenceDraft(input).themes[0].statements.map(row => [row.id, row.status, row.withheldReason])).toEqual([
      ["c2", "withheld", "paper-count"], ["a1", "withheld", "paper-count"], ["d2", "excerpt-bound", undefined], ["c0", "withheld", "paper-count"]]);
    const exports = exportEvidenceDraft(input), keys = buildEvidenceDraft(input).references.map(row => row.key);
    expect(keys).toHaveLength(2);
    expect(exports.markdown).toContain(`**Disagreement.** The first paper reports an improved outcome. [@${keys[0]}; @${keys[1]}] — retained excerpts: [1](#${one.id}), [2](#${two.id})`);
    expect(exports.latex).toContain(`\\autocite{${keys[0]},${keys[1]}}`);
    expect(exports.markdown).toContain("Withheld: 3 author statements are not exported");
  });

  it("labels a gap that cites no paper as author-stated and binds a gap that does cite one", () => {
    const input = twoPaperFixture(), excerpt = excerptOf(input, first.url);
    input.themes[0].statements = [statement({ id: "g0", kind: "gap", text: "No included study measures long-horizon tasks." }),
      statement({ id: "g1", kind: "gap", text: "The first paper leaves cost unmeasured.", paperUrls: [first.url], excerptIds: [excerpt.id] })];
    const draft = buildEvidenceDraft(input), exports = exportEvidenceDraft(input);
    expect(draft.themes[0].statements.map(row => row.status)).toEqual(["author-gap", "excerpt-bound"]);
    expect(exports.markdown).toContain("**Gap (author-stated; cites no paper; unverified).** No included study measures long-horizon tasks.");
    expect(exports.markdown).toContain(`**Gap.** The first paper leaves cost unmeasured. [@${draft.references[0].key}]`);
    expect(exports.latex).toContain("\\paragraph{Gap (author-stated; cites no paper; unverified)}");
  });

  it("refuses foreign, unknown and version-changed statement excerpts instead of substituting content", () => {
    const input = twoPaperFixture(), one = excerptOf(input, first.url);
    input.themes[0].statements = [statement({ paperUrls: [second.url], excerptIds: [one.id] })];
    expect(() => buildEvidenceDraft(input)).toThrow("different exact work");
    input.themes[0].statements = [statement({ paperUrls: [first.url], excerptIds: ["excerptmissing"] })];
    expect(() => buildEvidenceDraft(input)).toThrow("unavailable or changed");
    input.themes[0].statements = [statement({ paperUrls: [first.url], excerptIds: [one.id] })];
    input.reports[0].evidence![0].contentVersion = "sha256:other-version"; input.reports[0].citations[0].contentVersion = "sha256:other-version";
    expect(() => exportEvidenceDraft(input)).toThrow("unavailable or changed");
  });

  it("rejects duplicate statement identifiers across themes, duplicate selections and unbounded text", () => {
    const input = twoPaperFixture();
    input.themes.push({ id: "theme2", title: "Gaps", authorNote: "", excerptIds: [], statements: [statement({ kind: "gap" })] });
    input.themes[0].statements = [statement({ kind: "gap" })];
    expect(() => parseEvidenceDraftRequest(input)).toThrow("Duplicate draft identifiers");
    input.themes[1].statements = [statement({ id: "s2", paperUrls: [first.url, first.url] })];
    expect(() => parseEvidenceDraftRequest(input)).toThrow("Duplicate statement selections");
    for (const invalid of [{ text: " " }, { text: "x".repeat(601) }, { kind: "summary" }, { paperUrls: ["http://arxiv.org/abs/1"] }, { extra: true }]) {
      input.themes[1].statements = [{ ...statement({ id: "s2", kind: "gap" }), ...invalid } as never];
      expect(() => parseEvidenceDraftRequest(input)).toThrow();
    }
  });

  it("keeps another theme's statements when one theme is replaced", () => {
    const input = twoPaperFixture(), one = excerptOf(input, first.url);
    input.themes[0].statements = [statement({ paperUrls: [first.url], excerptIds: [one.id] })];
    input.themes.push({ id: "theme2", title: "Gaps", authorNote: "Edited", excerptIds: [], statements: [statement({ id: "g0", kind: "gap" })] });
    const next = replaceEvidenceDraftTheme(input, { id: "theme1", title: "Regenerated", authorNote: "", excerptIds: [], statements: [] });
    expect(next.themes[1]).toEqual(input.themes[1]); expect(next.themes[0].statements).toEqual([]);
    expect(input.themes[0].statements).toHaveLength(1);
  });

  it("quotes an excerpt once per theme and anchors it once across themes", () => {
    const input = twoPaperFixture(), one = excerptOf(input, first.url);
    input.themes[0].excerptIds = [one.id]; input.themes[0].statements = [statement({ paperUrls: [first.url], excerptIds: [one.id] })];
    input.themes.push({ id: "theme2", title: "Again", authorNote: "", excerptIds: [one.id] });
    const exports = exportEvidenceDraft(input);
    expect(exports.markdown.split(`> ${one.quote}`)).toHaveLength(3);
    expect(exports.markdown.split(`<a id="${one.id}"></a>`)).toHaveLength(2);
    expect(exports.latex.split(`\\label{${one.id}}`)).toHaveLength(2);
    expect(exports.referenceCount).toBe(1);
  });

  it("escapes statement text so it cannot add markup, commands or a citation key", () => {
    const input = twoPaperFixture(), one = excerptOf(input, first.url);
    input.themes[0].statements = [statement({ text: "See [@keryxDraftdeadbeef] <b>\n\\autocite{forged}", paperUrls: [first.url], excerptIds: [one.id] })];
    const exports = exportEvidenceDraft(input);
    expect(exports.markdown).toContain("See \\[\\@keryxDraftdeadbeef\\] \\<b\\> \\\\autocite\\{forged\\}");
    expect(exports.latex).not.toContain("\\autocite{forged}"); expect(exports.referenceCount).toBe(1);
  });

  it("returns statements through the shared MCP result", () => {
    const input = twoPaperFixture(), one = excerptOf(input, first.url);
    input.themes[0].statements = [statement({ paperUrls: [first.url], excerptIds: [one.id] })];
    const result = evidenceDraftTool({ draft: input });
    expect("structuredContent" in result && result.structuredContent?.draft.themes[0].statements[0].status).toBe("excerpt-bound");
    expect("structuredContent" in result && result.structuredContent?.exports.markdown).toContain("**Contribution.**");
  });
});

describe("draft citation and reference parity", () => {
  const exported = () => {
    const input = twoPaperFixture(), one = excerptOf(input, first.url), two = excerptOf(input, second.url);
    input.themes[0].excerptIds = [one.id];
    input.themes[0].statements = [statement({ kind: "agreement", paperUrls: [first.url, second.url], excerptIds: [one.id, two.id] })];
    const references = buildEvidenceDraft(input).references.map(row => ({ key: row.key, url: row.paper.url }));
    return { exports: exportEvidenceDraft(input), references };
  };

  it("accepts the exporter's own output with one entry per cited record in every format", () => {
    const { exports, references } = exported();
    expect(references).toHaveLength(2); expect(exports.referenceCount).toBe(2);
    expect(() => assertDraftCitationParity(exports, references)).not.toThrow();
    expect(exports.bibtex.match(/^@\w+\{keryxDraft[a-f0-9]+,$/gm)).toHaveLength(2);
    expect(exports.ris.match(/^TY {2}- /gm)).toHaveLength(2);
  });

  it("refuses a missing, extra or duplicated entry in any export", () => {
    const { exports, references } = exported(), [one, two] = references;
    const entry = exports.bibtex.slice(0, exports.bibtex.indexOf("\n}\n") + 3);
    const record = exports.ris.slice(0, exports.ris.indexOf("ER  - ") + 8);
    const line = exports.markdown.split("\n").find(row => row.startsWith(`- [@${one.key}] `))!;
    const drifted: Array<[string, Partial<typeof exports>]> = [
      ["bibtex entry missing", { bibtex: exports.bibtex.replace(entry, "") }],
      ["bibtex entry duplicated", { bibtex: exports.bibtex + "\n" + entry }],
      ["bibtex key changed", { bibtex: exports.bibtex.replace(`{${one.key},`, "{keryxDraft0,") }],
      ["ris record missing", { ris: exports.ris.replace(record, "") }],
      ["ris record for another url", { ris: exports.ris.replace(`UR  - ${one.url}`, "UR  - https://arxiv.org/abs/0000.00000v9") }],
      ["markdown reference line missing", { markdown: exports.markdown.replace(line + "\n", "") }],
      ["markdown reference line duplicated", { markdown: exports.markdown.replace(line, `${line}\n${line}`) }],
      ["markdown citation without reference", { markdown: exports.markdown.replace("\n## References\n", "\n[@keryxDraftfeed]\n\n## References\n") }],
      ["latex citation without reference", { latex: exports.latex + "\\autocite{keryxDraftfeed}\n" }],
      ["latex citation missing", { latex: exports.latex.replaceAll(two.key, one.key) }],
    ];
    for (const [name, change] of drifted)
      expect(() => assertDraftCitationParity({ ...exports, ...change }, references), name).toThrow("do not correspond");
    expect(() => assertDraftCitationParity(exports, [one]), "uncited reference").toThrow("do not correspond");
    expect(() => assertDraftCitationParity(exports, [one, two, two]), "duplicate reference key").toThrow("do not correspond");
  });
});

describe("related-work evaluation scorer", () => {
  const packet = (origin: "expert-written" | "synthetic-fixture" = "synthetic-fixture") => {
    const draft = twoPaperFixture(), one = excerptOf(draft, first.url);
    draft.themes[0].statements = [statement({ paperUrls: [first.url], excerptIds: [one.id] }),
      statement({ id: "s2", text: "It also reports a second finding.", paperUrls: [first.url], excerptIds: [one.id] }),
      statement({ id: "g0", kind: "gap" }), statement({ id: "w1", paperUrls: [second.url] })];
    return { version: 1, scope: "related-work-evaluation", reviews: [{ id: "review1", referenceOrigin: origin,
      expertWorks: [{ url: first.url }, { url: second.url }, { doi: "10.1000/never-saved" }, { url: first.url }], draft,
      judgments: [{ statementId: "s1", verdict: "supported", reviewer: "Fixture reviewer" }] }] };
  };

  it("counts exact-record coverage and restates only the supplied judgments", () => {
    const result = evaluateRelatedWorkDrafts(packet());
    expect(result.reviews[0]).toMatchObject({ expertWorks: 3, expertWorksCited: 1, coverage: 1 / 3, draftReferences: 1,
      draftReferencesOutsideExpertList: 0, includedWithoutRetainedExcerpt: 0,
      statements: { citing: 2, authorGap: 1, withheld: 1 }, judged: 1, unjudged: 1, unsupported: 0, unsupportedStatementRate: 0 });
  });

  it("never reports a synthetic fixture or a partly judged review as measured", () => {
    const synthetic = evaluateRelatedWorkDrafts(packet());
    expect(synthetic.aggregate).toMatchObject({ status: "not-measured", expertReviews: 0, syntheticReviewsExcluded: 1, coverage: null, unsupportedStatementRate: null });
    const partial = evaluateRelatedWorkDrafts(packet("expert-written"));
    expect(partial.aggregate).toMatchObject({ status: "not-measured", expertReviews: 1, unjudged: 1 });
    const complete = packet("expert-written");
    complete.reviews[0].judgments.push({ statementId: "s2", verdict: "unsupported", reviewer: "Fixture reviewer" });
    expect(evaluateRelatedWorkDrafts(complete).aggregate).toMatchObject({ status: "measured", coverage: 1 / 3, judged: 2, unsupported: 1, unsupportedStatementRate: 0.5 });
  });

  it("matches an expert work by exact normalized DOI and never by title", () => {
    const input = packet(), paper = input.reviews[0].draft.workspace.entries[0].paper;
    input.reviews[0].expertWorks = [{ doi: "10.1000/never-saved" }];
    expect(evaluateRelatedWorkDrafts(input).reviews[0]).toMatchObject({ expertWorksCited: 0, draftReferencesOutsideExpertList: 1 });
    if (paper.doi) {
      input.reviews[0].expertWorks = [{ doi: `https://doi.org/${paper.doi.toUpperCase()}` }];
      expect(evaluateRelatedWorkDrafts(input).reviews[0].expertWorksCited).toBe(1);
    }
  });

  it("refuses judgments for withheld, gap, unknown or repeated statements and malformed packets", () => {
    for (const statementId of ["w1", "g0", "missing"]) {
      const input = packet(); input.reviews[0].judgments = [{ statementId, verdict: "unsupported", reviewer: "Fixture reviewer" }];
      expect(() => evaluateRelatedWorkDrafts(input), statementId).toThrow("not exported with a citation");
    }
    const repeated = packet(); repeated.reviews[0].judgments.push({ ...repeated.reviews[0].judgments[0] });
    expect(() => evaluateRelatedWorkDrafts(repeated)).toThrow("Duplicate statement judgments");
    const twice = packet(); twice.reviews.push({ ...twice.reviews[0] });
    expect(() => evaluateRelatedWorkDrafts(twice)).toThrow("Duplicate review identifiers");
    for (const invalid of [{ ...packet(), scope: "other" }, { ...packet(), reviews: [] },
      { ...packet(), reviews: [{ ...packet().reviews[0], expertWorks: [{}] }] }, { ...packet(), reviews: [{ ...packet().reviews[0], draft: { passage: "x" } }] }])
      expect(() => evaluateRelatedWorkDrafts(invalid)).toThrow();
  });
});
