import { expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";

class PlanningEngine extends JsonChatEngine {
  readonly name = "synthetic-proposal-planning";
  prompt = "";
  constructor(private readonly response: Record<string, unknown>) { super(); }
  protected async chatJson(_model: string, system: string) { this.prompt = system; return this.response; }
}

it("retains requested prospective teaching proposals as constraints, with factual target order intact", async () => {
  const claims = ["What is weather?", "What is climate?", "Why does one day's weather not establish a climate trend?"];
  const engine = new PlanningEngine({ status: "complete", claims,
    constraints: ["Read the supplied NASA source", "Vietnamese, explanation under 100 words",
      "Propose two examples, a ten-minute activity and an exit question; label them as proposals"] });
  expect(await engine.decompose("Tôi dạy lớp 7: giải thích thời tiết/khí hậu, đề xuất hai ví dụ, hoạt động 10 phút và câu hỏi cuối giờ; không nói NASA đã thử chúng."))
    .toEqual(claims);
  expect(engine.prompt).toContain("prospective delivery constraint");
  expect(engine.prompt).toContain("If the user instead asks which activities NASA actually tested");
});

it("preserves an explicit historical activity claim rather than treating it as a proposed exercise", async () => {
  const claims = ["Which weather classification activities did NASA actually test, and what outcomes did it report?"];
  const engine = new PlanningEngine({ status: "complete", claims, constraints: ["Use the requested NASA original"] });
  expect(await engine.decompose("Which weather classification activities did NASA actually test? Cite its reported outcomes."))
    .toEqual(claims);
});
