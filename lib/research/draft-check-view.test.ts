import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DraftCheckResults, DraftCheckWorkspace } from "../../components/keryx/draft-check-workspace";
import { buildDraftCheck } from "./draft-check";
import { draftCheckFixture } from "./fixtures/draft-check";

it("opens empty with the privacy statement and nothing to submit", () => {
  const html = renderToStaticMarkup(createElement(DraftCheckWorkspace));
  expect(html).toContain("Nothing is uploaded or added to public history.");
  expect(html).toContain("Nothing is saved unless you choose");
  expect(html).toContain("Save on this device");
  expect(html).toContain("Wording check, not semantic or expert review.");
  expect(html).not.toContain("<form");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Check cited sentences<\/button>/);
});

it("shows each verdict with its exact excerpt, the unavailable source and the flags", () => {
  const fixture = draftCheckFixture();
  const result = buildDraftCheck({ ...fixture, passage: `${fixture.passage} Costs fell after the reform [1]. Jones et al. [1] disagree <b>strongly</b> (Brown, 2001).`,
    sources: [{ ...fixture.sources[0], text: `${fixture.sources[0].text} Costs did not fall after the reform.` }] });
  const html = renderToStaticMarkup(createElement(DraftCheckResults, { result }));
  expect(html).toContain("Sentences: 5 · supported: 1 · partly supported: 0 · not found: 1 · source unavailable: 2 · not checked: 1");
  expect(html).toContain("<blockquote class=\"mt-2 whitespace-pre-wrap border-l-2 border-seal pl-3 font-serif text-sm text-ink\">We show that retrieval improves factual accuracy on open-domain questions.</blockquote>");
  expect(html).toContain("No text was supplied for this work, so it was not checked.");
  expect(html).toContain("This sentence has no citation.");
  expect(html).toContain("No supporting passage found in the text you supplied.");
  expect(html).toContain("Closest passage, not counted as support · It differs in negation.");
  expect(html).toContain("Costs did not fall after the reform.");
  expect(html).toContain("Only part of this work was supplied; the rest was not searched.");
  expect(html).toContain("Sentence 5: the text names Jones, who is not an author of ref1.");
  expect(html).toContain("Sentence 5: citation Brown 2001 could not be matched to one listed work.");
  // Passage text is rendered as text, never as markup.
  expect(html).toContain("&lt;b&gt;strongly&lt;/b&gt;"); expect(html).not.toContain("<b>strongly</b>");
});

it("shows an unreadable reference as unavailable despite matching caller text", () => {
  const result = buildDraftCheck({ ...draftCheckFixture(), passage: "Retrieval improves factual accuracy [1].",
    references: { format: "bibtex", text: "@article{broken, title={Unterminated" },
    sources: [{ reference: "broken", coverage: "partial", text: "Retrieval improves factual accuracy." }] });
  const html = renderToStaticMarkup(createElement(DraftCheckResults, { result }));
  expect(html).toContain("This citation could not be bound to a readable reference in the list.");
  expect(html).toContain("Source unavailable");
  expect(html).not.toContain("<blockquote");
  expect(html).not.toContain("Wording supported by the quoted passage");
});
