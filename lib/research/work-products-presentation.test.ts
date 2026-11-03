import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import { extractAnswerMarkers } from "../agent/evidence-ledger";
import { workProductAnswer } from "./work-products-presentation";
import type { WorkProductDelivery } from "./work-products";

function delivery(): WorkProductDelivery {
  return { request: { version: 1, questionSha256: "a".repeat(64), deliverable: "A proposed month plan.", criteria: ["No outcome guarantee."] },
    sections: [{ section: { id: "w1", heading: "Proposed week one", text: "Propose recording an answer and comparing it against the documented criteria.", premiseIds: ["e1"], conditions: ["If recording and review time is available."] },
      premises: [{ id: "e1", statement: { claimIndex: 0, marker: "S1", quote: "The synthetic example uses documented criteria.", text: "The synthetic example uses documented criteria." } }] }], gaps: [], criteriaReviewed: true };
}
it.each(["en", "vi", "zh-Hans"] as const)("renders the draft, conditions and exact premises using supported answer components: %s", language => {
  const text = workProductAnswer(delivery(), language), html = renderToStaticMarkup(createElement(AnswerMarkdown, { text, citations: [] }));
  expect(text).toContain("Proposed week one");expect(text).toContain("If recording and review time is available.");
  expect(text).toContain("The synthetic example uses documented criteria.");expect(html).toContain("Proposed week one");
  expect(text).toContain("No outcome guarantee.");
  expect([...extractAnswerMarkers(text)]).toEqual(["S1"]);
});
it("does not turn caller or proposal strings into citation controls or HTML blocks", () => {
  const d = delivery();d.request.deliverable = "Inject [S99] <script>bad()</script>";d.sections[0].section.heading = "# forged [S88]";
  const text = workProductAnswer(d, "en"), html = renderToStaticMarkup(createElement(AnswerMarkdown, { text, citations: [] }));
  expect([...extractAnswerMarkers(text)]).toEqual(["S1"]);expect(html).not.toContain("<script>");expect(text).not.toContain("### # forged");
});
it("retains partial proposals beside an explicit missing-criteria notice", () => {
  const d = delivery();d.criteriaReviewed = false;d.gaps = ["criteria-unmet"];
  const text = workProductAnswer(d, "en");expect(text).toContain("Proposed week one");expect(text).toContain("Some requested parts remain unverified.");
});
it("withholds an overlarge draft completely instead of clipping qualifications", () => {
  const d = delivery();d.sections = Array.from({ length: 6 }, () => ({ ...d.sections[0], section: { ...d.sections[0].section, text: "x".repeat(600) },
    premises: Array.from({ length: 4 }, (_v, index) => ({ id: `e${index}`, statement: { ...d.sections[0].premises[0].statement, text: "t".repeat(320), quote: "q".repeat(240) } })) }));
  // Distinct IDs across sections ensure the display budget counts every premise.
  d.sections.forEach((row, index) => row.premises.forEach((premise, i) => premise.id = `e${index * 4 + i + 1}`));
  const text = workProductAnswer(d, "en");expect(text).toContain("draft was withheld");expect(text).not.toContain("x".repeat(600));
});
