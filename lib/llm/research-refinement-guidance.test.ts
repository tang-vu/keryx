import { inspect } from "node:util";
import { expect, it, vi } from "vitest";
import { boundedResearchPlan, ResearchPlanningError, researchFailureMessage, type PlanningRefusalReason } from "./research-plan";

const reasons: PlanningRefusalReason[] = ["expanded_output", "invalid_output", "needs_refinement"];
it.each(reasons)("offers general clarification for a short request without inventing a subject: %s", reason => {
  const error = new ResearchPlanningError("book", reason);
  expect(error).toMatchObject({ status: 422, code: "research_plan_refinement_required", maximumTargets: 8, reason, language: "en" });
  expect(error.scopeChoices).toEqual([]);
  const message = researchFailureMessage(error);
  expect(message).toContain("State the topic and the result you need");
  expect(message).toContain("explanation, comparison, plan or shortlist");
  expect(message).toContain("keeping the original source URLs/versions and qualifications");
  expect(message).not.toMatch(/novel|fiction|recommend.{0,12}book|best book/iu);
});
it.each(reasons)("offers the same subject/outcome/scope clarification through the existing Vietnamese path: %s", reason => {
  const error = new ResearchPlanningError("giải thích sách", reason);
  expect(error.language).toBe("vi");
  expect(researchFailureMessage(error)).toContain("Hãy nêu rõ chủ đề và kết quả bạn cần");
  expect(researchFailureMessage(error)).toContain("giữ các URL/phiên bản và điều kiện nguồn");
});
it("preserves private excerpt handling, caller-only focus choices and output-limit details", () => {
  const question = "PRIVATE_REQUEST compare original versions?\nKeep https://user:secret@example.org/private?q=secret#part and all qualifications.";
  const error = new ResearchPlanningError(question, "expanded_output", 2048);
  for (const generic of [error.message, JSON.stringify(error), inspect(error)]) expect(generic).not.toMatch(/PRIVATE_REQUEST|user:secret|q=secret/);
  const message = researchFailureMessage(error);
  expect(message).toContain("PRIVATE_REQUEST");expect(message).toContain("2,048-token output limit");
  expect(message).toContain("not a new question or an automatic retry");
  expect(message).not.toMatch(/user:secret|q=secret/);expect(error.scopeChoices.length).toBeLessThanOrEqual(3);
});
it("keeps a supplier's refinement terminal without another generation or an invented replacement question", async () => {
  const supplier = vi.fn(async () => ({ status: "needs_refinement", claims: [] }));
  await expect(boundedResearchPlan("book", supplier)).rejects.toMatchObject({ reason: "needs_refinement", maximumTargets: 8 });
  expect(supplier).toHaveBeenCalledTimes(1);expect(supplier).toHaveBeenCalledWith();
  expect(researchFailureMessage(new Error("unchanged transport error"))).toBe("unchanged transport error");
});
