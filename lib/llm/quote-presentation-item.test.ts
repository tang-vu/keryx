import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { evidenceContext } from "./evidence-context";
import { applyEvidenceReview } from "./evidence-review";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { compactStatementGroups } from "../agent/compact-statement-groups";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { answerPresentation } from "../research/answer-presentation";
import { observeHtmlTextLayout } from "../web-research/html-text-layout";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";
import type { GatheredContent, ProposedEvidence } from "./reasoning-engine";
import body from "./fixtures/issue-238-mdn-button.json";
import captured from "../agent/fixtures/mdn-public-presentation-20261009.json";
import { statementPresentationItem } from "./quote-presentation-item";

function frozenSource(): GatheredContent {
  expect(createHash("sha256").update(body.text).digest("hex")).toBe(captured.sourceIdentity.contentVersion);
  // Explicit synthetic trusted parser-layout fixture over retained exact bytes.
  // The public capture did not serialize its original runtime layout capability.
  const layout = observeHtmlTextLayout(body.text, { format: "keryx-html-text-layout-v1",
    textCharacters: body.text.length, textSha256: captured.sourceIdentity.contentVersion,
    limited: false, preformatted: [], headings: [] });
  return { ...gatheredArticle(captured.sourceIdentity.sourceId, { text: body.text, finalUrl: captured.sourceIdentity.itemUrl,
    title: "Retained MDN fixture", kind: "html", truncated: false, htmlTextLayout: layout }), marker: "S1" };
}
function replay(source = frozenSource(), optIn = true, change?: (proposals: ProposedEvidence[]) => ProposedEvidence[], copyOptions = false) {
  const options = buildQuoteOptions(evidenceContext(captured.question, captured.targets, [source]), [source], { includeShortBlocks: optIn });
  const selected = captured.pairs.map(pair => {
    const option = options.find(option => option.text === pair.quote);
    expect(option).toBeDefined();
    return { claimIndex: pair.claimIndex, marker: pair.marker, quoteId: option!.quoteId, statement: pair.text, support: 1 };
  });
  let proposals = resolveQuoteEvidence(selected, copyOptions ? options.map(option => ({ ...option })) : options);
  if (change) proposals = change(proposals);
  // Synthetic review values exercise existing admission, not historical captured scores.
  const reviewed = applyEvidenceReview(proposals, { reviews: proposals.map((_, index) => ({ index, support: 1, statementSupport: 1 })) });
  const ledger = buildEvidenceLedger({ question: captured.question, subClaims: captured.targets, gathered: [source],
    answer: "[S1]", declaredMarkers: ["S1"], proposedEvidence: reviewed,
    finalAssessment: captured.targets.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
  const statements = selectCitedStatements(reviewed, ledger);
  return { source, options, proposals: reviewed, ledger, statements,
    answer: finalizeGroundedAnswer({ question: captured.question, answer: "[S1]", ledger, statements,
      presentation: answerPresentation(captured.question) }) };
}

describe("process-local exact short-item presentation", () => {
  it("groups the captured separate submit/default quotes into three items while retaining all five public pairs", () => {
    const result = replay();
    expect(result.ledger.droppedEvidence).toBe(0);
    expect(result.statements).toHaveLength(5);
    expect(result.answer.match(/^- /gm)).toHaveLength(3);
    const rows = result.answer.split("\n\n");
    expect(rows[0]).toContain(captured.pairs[0].text);
    expect(rows[0]).toContain(captured.pairs[4].text);
    for (const pair of captured.pairs) {
      const row = rows.find(row => row.includes(pair.text));
      expect(row).toContain(`“${pair.quote}”`);
      expect(row).toContain("[S1]");
    }
    expect(result.ledger.evidence.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
    const ordinary = buildQuoteOptions(evidenceContext(captured.question, captured.targets, [result.source]), [result.source]);
    expect(result.options.slice(0, ordinary.length)).toEqual(ordinary);
  });
  it("keeps default/private behavior and serialized public records unchanged", () => {
    const source = frozenSource();
    const old = replay(source, false), current = replay(source);
    expect(old.answer).toContain("Não foi possível apresentar 3");
    expect(JSON.stringify(current.ledger)).toBe(JSON.stringify(old.ledger));
    expect(JSON.stringify(current.statements)).toBe(JSON.stringify(old.statements));
    expect(finalizeGroundedAnswer({ question: captured.question, answer: "[S1]", ledger: current.ledger, statements: current.statements }))
      .toBe(finalizeGroundedAnswer({ question: captured.question, answer: "[S1]", ledger: old.ledger, statements: old.statements }));
  });
  it("does not restore presentation proof from JSON spans/statements or forged numeric offsets", () => {
    const copied = replay(frozenSource(), true, proposals => JSON.parse(JSON.stringify(proposals)));
    expect(copied.ledger.droppedEvidence).toBe(0);
    expect(copied.answer).toContain("Não foi possível apresentar 3");
    const forged = replay(frozenSource(), true, proposals => proposals.map(proposal => ({ ...proposal, quoteSpan: { ...proposal.quoteSpan! } })));
    expect(forged.answer).toContain("Não foi possível apresentar 3");
    expect(replay(frozenSource(), true, undefined, true).answer).toContain("Não foi possível apresentar 3");
    const current = replay();
    expect(compactStatementGroups(JSON.parse(JSON.stringify(current.statements)), current.ledger.evidence)).toHaveLength(4);
  });
  it("does not mint proof from copied layout or changed source/body/statement identities", () => {
    const source = frozenSource();
    source.htmlTextLayout = JSON.parse(JSON.stringify(source.htmlTextLayout));
    expect(replay(source).answer).toContain("Não foi possível apresentar 3");
    for (const mode of ["body", "version", "source", "item", "url", "marker", "role", "layout", "statement"]) {
      const current = replay();
      if (mode === "body") current.source.text += "Changed body.";
      else if (mode === "version") current.source.contentVersion = "f".repeat(64);
      else if (mode === "source") current.source.sourceId += ":changed";
      else if (mode === "item") current.source.itemId += ":changed";
      else if (mode === "url") current.source.itemUrl += "?changed";
      else if (mode === "marker") current.source.marker = "S2";
      else if (mode === "role") delete current.source.sourceKind;
      else if (mode === "layout") current.source.htmlTextLayout = observeHtmlTextLayout(current.source.text,
        { ...current.source.htmlTextLayout!, preformatted: [{ start: 0, end: current.source.text.length }] });
      else current.statements[0].text += " Changed sentence.";
      expect(compactStatementGroups(current.statements, current.ledger.evidence)).toHaveLength(4);
    }
  });
  it("withholds whole-item proof for partial or gapped original passages", () => {
    const source = frozenSource();
    const context = evidenceContext(captured.question, captured.targets, [source])[0]!;
    const quotes = [captured.pairs[0].quote, captured.pairs[4].quote];
    const singles = quotes.map(text => ({ start: source.text.indexOf(text), end: source.text.indexOf(text) + text.length, text }));
    for (const passages of [[singles[0]], singles]) {
      const options = buildQuoteOptions([{ ...context, passages }], [source], { includeShortBlocks: true });
      expect(options).toHaveLength(passages.length);
      const proposals = resolveQuoteEvidence(options.map((option, index) => ({ claimIndex: index, marker: "S1",
        quoteId: option.quoteId, statement: `Separately admitted sentence ${index}.`, support: 1 })), options);
      const reviewed = applyEvidenceReview(proposals, { reviews: proposals.map((_, index) => ({ index, support: 1, statementSupport: 1 })) });
      const targets = proposals.map((_, index) => `Target ${index}`);
      const ledger = buildEvidenceLedger({ subClaims: targets, gathered: [source], answer: "[S1]", declaredMarkers: ["S1"],
        proposedEvidence: reviewed, finalAssessment: targets.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
      const statements = selectCitedStatements(reviewed, ledger);
      expect(statements).toHaveLength(passages.length);
      expect(statements.map(statement => statementPresentationItem(statement, ledger.evidence))).toEqual(passages.map(() => undefined));
    }
  });
  it("does not propagate grouping through conflicting admitted ledger identities", () => {
    const current = replay();
    const changed = { ...current.ledger, evidence: current.ledger.evidence.map(row => ({ ...row, itemId: "different-item" })) };
    const statements = selectCitedStatements(current.proposals, changed);
    expect(statements).toHaveLength(5);
    expect(statements.map(statement => statementPresentationItem(statement, changed.evidence))).toEqual(statements.map(() => undefined));
    expect(compactStatementGroups(statements, changed.evidence)).toHaveLength(4);
    expect(compactStatementGroups(current.statements, changed.evidence)).toHaveLength(4);
  });
  it("cannot transitively pull another block through an existing shared-target group", () => {
    const current = replay();
    // The separately admitted reset sentence shares the submit target. The old
    // target group survives, but it must not acquire a new default-item edge.
    const proposals = current.proposals.map((proposal, index) => index === 1 ? { ...proposal, claimIndex: 0 } : proposal);
    const ledger = buildEvidenceLedger({ subClaims: captured.targets, gathered: [current.source], answer: "[S1]",
      declaredMarkers: ["S1"], proposedEvidence: proposals,
      finalAssessment: captured.targets.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
    const statements = selectCitedStatements(proposals, ledger);
    expect(compactStatementGroups(statements, ledger.evidence)?.map(group => group.map(statement => statement.quote)))
      .toEqual([[captured.pairs[0].quote, captured.pairs[1].quote],
        [captured.pairs[2].quote, captured.pairs[3].quote], [captured.pairs[4].quote]]);
  });
  it("never bridges separately observed list items, even with identical source identity", async () => {
    const original = { ...gatheredArticle("public:fixture", await extractHtml("<main><p>Ordinary introductory context supplies sufficient visible extraction content.</p><ul><li>alpha: First rule applies. Its default is first.</li><li>beta: Second rule applies. Its default is second.</li></ul></main>", "https://example.com/items")), marker: "S1" };
    const options = buildQuoteOptions(evidenceContext("rules", ["rules"], [original]), [original], { includeShortBlocks: true });
    const wanted = new Set(["alpha: First rule applies.", "Its default is first.", "beta: Second rule applies.", "Its default is second."]);
    const singles = options.filter(option => wanted.has(option.text));
    expect(singles).toHaveLength(4);
    const proposals = resolveQuoteEvidence(singles.map((option, claimIndex) => ({ claimIndex, marker: "S1", quoteId: option.quoteId, statement: `Recorded sentence ${claimIndex}.`, support: 1 })), options);
    const reviewed = applyEvidenceReview(proposals, { reviews: proposals.map((_, index) => ({ index, support: 1, statementSupport: 1 })) });
    const targets = proposals.map((_, index) => `Target ${index}`);
    const ledger = buildEvidenceLedger({ subClaims: targets, gathered: [original], answer: "[S1]", declaredMarkers: ["S1"], proposedEvidence: reviewed,
      finalAssessment: targets.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
    const statements = selectCitedStatements(reviewed, ledger);
    const groups = compactStatementGroups(statements, ledger.evidence)!;
    expect(groups.map(group => group.length)).toEqual([2, 2]);
  });
  it("cannot use grouping to restore an unreviewed statement or lost target", () => {
    const current = replay();
    const reviewed = applyEvidenceReview(current.proposals, { reviews: current.proposals.map((_, index) =>
      ({ index, support: 1, statementSupport: index === 4 ? 0 : 1 })) });
    const statements = selectCitedStatements(reviewed, current.ledger);
    expect(statements).toHaveLength(4);
    const answer = finalizeGroundedAnswer({ question: captured.question, answer: "[S1]", ledger: current.ledger,
      statements, presentation: answerPresentation(captured.question) });
    expect(answer).toContain("Não foi possível apresentar 3");
    expect(answer).toContain(captured.pairs[4].quote);
    expect(answer).not.toContain(captured.pairs[4].text);
  });
  it("adds no proof when whole-item alternatives cannot fit the unchanged menu cap", async () => {
    const html = `<main><ul>${Array.from({ length: 32 }, (_, index) => `<li>choice${index}: The rule applies. It remains bounded.</li>`).join("")}</ul></main>`;
    const source = { ...gatheredArticle("public:fixture", await extractHtml(html, "https://example.com/dense")), marker: "S1" };
    const context = evidenceContext("choice29", ["choice29"], [source]);
    const ordinary = buildQuoteOptions(context, [source]), compact = buildQuoteOptions(context, [source], { includeShortBlocks: true });
    expect(ordinary).toHaveLength(64);
    expect(compact).toEqual(ordinary);
    const proposals = resolveQuoteEvidence(compact.slice(0, 2).map((option, claimIndex) =>
      ({ claimIndex, marker: "S1", quoteId: option.quoteId, statement: `Admitted sentence ${claimIndex}.`, support: 1 })), compact);
    const reviewed = applyEvidenceReview(proposals, { reviews: proposals.map((_, index) => ({ index, support: 1, statementSupport: 1 })) });
    const targets = ["First", "Second"], ledger = buildEvidenceLedger({ subClaims: targets, gathered: [source], answer: "[S1]",
      declaredMarkers: ["S1"], proposedEvidence: reviewed, finalAssessment: targets.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
    expect(selectCitedStatements(reviewed, ledger).map(statement => statementPresentationItem(statement, ledger.evidence))).toEqual([undefined, undefined]);
  });
  it("withholds proof for preformatted, truncated, PDF and oversized item boundaries", async () => {
    const short = "alpha: First rule applies. An absent setting selects first.";
    const introduction = "<p>Ordinary introductory context supplies sufficient visible extraction content.</p>";
    const normal = { ...gatheredArticle("public:fixture", await extractHtml(`<main>${introduction}<ul><li>${short}</li></ul></main>`, "https://example.com/short")), marker: "S1" };
    const pre = { ...gatheredArticle("public:fixture", await extractHtml(`<main>${introduction}<pre>${short}</pre></main>`, "https://example.com/pre")), marker: "S1" };
    const long = { ...gatheredArticle("public:fixture", await extractHtml(`<main><ul><li>alpha: First rule applies. ${"Long context ".repeat(24)}ends.</li></ul></main>`, "https://example.com/long")), marker: "S1" };
    for (const source of [pre, long, { ...normal, webProvenance: { ...normal.webProvenance!, truncated: true } },
      { ...normal, webProvenance: { ...normal.webProvenance!, extraction: "pdf" as const } }]) {
      const options = buildQuoteOptions(evidenceContext("rule", ["rule"], [source]), [source], { includeShortBlocks: true });
      expect(options.length).toBeGreaterThan(0);
      const proposals = resolveQuoteEvidence(options.slice(0, 2).map((option, claimIndex) =>
        ({ claimIndex, marker: "S1", quoteId: option.quoteId, statement: `Admitted sentence ${claimIndex}.`, support: 1 })), options);
      const reviewed = applyEvidenceReview(proposals, { reviews: proposals.map((_, index) => ({ index, support: 1, statementSupport: 1 })) });
      const targets = proposals.map((_, index) => `Target ${index}`), ledger = buildEvidenceLedger({ subClaims: targets,
        gathered: [source], answer: "[S1]", declaredMarkers: ["S1"], proposedEvidence: reviewed,
        finalAssessment: targets.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
      const statements = selectCitedStatements(reviewed, ledger);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) expect(statementPresentationItem(statement, ledger.evidence)).toBeUndefined();
    }
  });
});
