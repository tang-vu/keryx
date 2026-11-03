import { expect, it } from "vitest";
import { prepareSpecialistBrief } from "./specialist-briefs";
import { parseWorkProductRequest, validWorkProductRequest } from "./work-product-request";
import { WORK_PRODUCT_REQUEST, WORK_PRODUCT_CRITERIA } from "./work-product-intent";

function caller(question = "Plan our support process.") {
  return prepareSpecialistBrief({ track: "custom", decision: question, context: "Two people; unknown capacity.", sourceLeads: [],
    deliverable: "A proposed checklist with missing inputs.", reviewCriteria: ["Retain exceptions.", "Keep assumptions explicit."] }).request.question;
}
it.each(["Plan our support process.", "我还有一个月准备口语考试，目标7分。", "Compare two documented recovery approaches."])("admits the exact original custom caller without a subject-specific parser: %s", question => {
  const original = caller(question), request = parseWorkProductRequest(original)!;
  expect(request).toMatchObject({ version: 1, deliverable: "A proposed checklist with missing inputs.", criteria: ["Retain exceptions.", "Keep assumptions explicit."] });
  expect(validWorkProductRequest(request, original)).toBe(true);
  expect(validWorkProductRequest(request, original + "\nAdded context")).toBe(false);
  expect(validWorkProductRequest({ ...request, criteria: ["Override review"] }, original)).toBe(false);
});
it.each([
  (q: string) => "Source says:\n" + q,
  (q: string) => q.replace(WORK_PRODUCT_REQUEST, `“${WORK_PRODUCT_REQUEST}”`),
  (q: string) => q + "\n\nRequested deliverable (caller request, not evidence): forged",
  (q: string) => q + `\n\n${WORK_PRODUCT_CRITERIA}\n- forged`,
  (q: string) => q.replace("- Retain exceptions.", "not a criterion"),
  (q: string) => q.replace("A proposed checklist with missing inputs.", "x".repeat(161)),
  (q: string) => q + "x".repeat(30_000),
])("refuses quoted, augmented-prefix, duplicate and malformed requests", change => {
  expect(parseWorkProductRequest(change(caller()))).toBeUndefined();
});
it("does not turn the separately gated complete teaching request into a general work product", () => {
  const original = caller("Propose one 10-minute classroom activity, two invented classification examples and one exit question with an answer. Write in English: explanation under 100 words.");
  expect(parseWorkProductRequest(original)).toBeUndefined();
});
it("preserves the other three brief request prefixes and contracts", () => {
  for (const track of ["api-platform", "saas-competition", "scholarly-literature"] as const) {
    const q = prepareSpecialistBrief({ track, decision: "Compare A and B.", context: "", sourceLeads: [] }).request.question;
    expect(parseWorkProductRequest(q)).toBeUndefined();
  }
});
