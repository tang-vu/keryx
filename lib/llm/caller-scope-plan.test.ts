import { describe, expect, it, vi } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { parseResearchPlan, ResearchPlanningError } from "./research-plan";
import { ResilientEngine } from "./resilient-engine";
import { MemoryReasoningCircuitStore } from "./reasoning-circuit-store";

type Part = { text: string; role: "target" | "scope" | "delivery" | "framing" };
const proposal = (parts: Part[]) => ({ status: "complete", request: { parts } });
const population = "What is the expected population of China in 2050?";

class PlanningEngine extends JsonChatEngine {
  readonly name = "synthetic-caller-scope";
  packets: string[] = [];
  constructor(private replies: Record<string, unknown>[]) { super(); }
  protected async chatJson(_model: string, _system: string, user: string) {
    this.packets.push(user);
    const reply = this.replies.shift();
    if (!reply) throw new Error("Unexpected extra model call");
    return reply;
  }
}

describe("caller-owned factual research scope", () => {
  it("sends only the requested population figure to coverage assessment", async () => {
    // Controlled source/assessment, not a real population projection or accuracy evaluation.
    const engine = new PlanningEngine([proposal([{ text: population, role: "target" }]), {
      rationale: "The controlled passage answers the requested figure.",
      perClaim: [{ claim: population, supportedAnswer: "The fixture projects 123 residents.",
        coverage: 1, coveredBy: ["S1"], missingRequestedParts: [] }],
    }]);
    const subClaims = await engine.decompose(population);
    expect(subClaims).toEqual([population]);
    const assessment = await engine.sufficiency({ question: population, subClaims,
      gathered: [{ sourceId: "fixture", sourceName: "Controlled projection", marker: "S1", text: "The fixture projects 123 residents in 2050." }] });
    expect(assessment.sufficient).toBe(true);
    expect(JSON.parse(engine.packets[1]).subClaims).toEqual([population]);
    expect(engine.packets).toHaveLength(2);
  });

  it("rejects an added uncertainty requirement rather than turning it into a completion gate", () => {
    const expanded = proposal([{ text: population.replace("?", ", and what range or uncertainty do major projections give?"), role: "target" }]);
    expect(() => parseResearchPlan(population, expanded)).toThrow(ResearchPlanningError);
  });

  it("keeps explicitly requested uncertainty as its own unmet target", async () => {
    const uncertainty = "What is the uncertainty range?";
    const question = population + " " + uncertainty;
    const engine = new PlanningEngine([proposal([
      { text: population, role: "target" }, { text: " ", role: "framing" }, { text: uncertainty, role: "target" },
    ]), { perClaim: [
      { supportedAnswer: "A controlled point estimate.", coverage: 1, coveredBy: ["S1"], missingRequestedParts: [] },
      { supportedAnswer: "", coverage: 0, coveredBy: [], missingRequestedParts: ["Requested uncertainty range"] },
    ] }]);
    const subClaims = await engine.decompose(question);
    expect(subClaims).toEqual([population, uncertainty]);
    expect((await engine.sufficiency({ question, subClaims,
      gathered: [{ sourceId: "fixture", sourceName: "Controlled projection", marker: "S1", text: "A controlled point estimate only." }] })).sufficient).toBe(false);
  });

  it("retains source versions and factual conditions on every target while leaving delivery in the original question", () => {
    const scope = "For readers using WAL, use https://example.org/manual?v=2#limits; do not assume the writer has finished.";
    const delivery = "Answer in Vietnamese with two bullets.";
    const parts: Part[] = [
      { text: "How do readers proceed?", role: "target" }, { text: " ", role: "framing" },
      { text: "When can a writer block?", role: "target" }, { text: " ", role: "framing" },
      { text: scope, role: "scope" }, { text: " ", role: "framing" }, { text: delivery, role: "delivery" },
    ];
    const question = parts.map(part => part.text).join("");
    const result = parseResearchPlan(question, { ...proposal(parts), constraints: [scope, delivery] });
    expect(result).toEqual(["How do readers proceed?\n" + scope, "When can a writer block?\n" + scope]);
    expect(result.every(target => !target.includes("two bullets"))).toBe(true);
  });

  it("restores boundary whitespace without rewriting caller wording", () => {
    const question = "  First requested fact?\n\nSecond requested fact?  ";
    expect(parseResearchPlan(question, proposal([
      { text: "First requested fact?", role: "target" }, { text: "Second requested fact?", role: "target" },
    ]))).toEqual(["First requested fact?", "Second requested fact?"]);
  });

  it.each([
    "Dân số dự kiến của Trung Quốc năm 2050 là bao nhiêu?",
    "¿Cuál es la población prevista de China en 2050?",
    "中国2050年的预计人口是多少？",
  ])("preserves a single caller target without translation or added requirements: %s", question => {
    expect(parseResearchPlan(question, proposal([{ text: question, role: "target" }]))).toEqual([question]);
  });

  it.each([
    { name: "omitted qualification", parts: [{ text: population, role: "target" }] },
    { name: "changed version", parts: [{ text: population, role: "target" }, { text: " Use edition V3.", role: "scope" }] },
    { name: "reordered spans", parts: [{ text: " Use edition V2.", role: "scope" }, { text: population, role: "target" }] },
    { name: "no factual target", parts: [{ text: population + " Use edition V2.", role: "delivery" }] },
  ])("refuses $name without silently changing scope", ({ parts }) => {
    expect(() => parseResearchPlan(population + " Use edition V2.", proposal(parts as Part[]))).toThrow(ResearchPlanningError);
  });

  it.each(["framing", "delivery", "target"] as const)("refuses a source URL outside scope (%s)", role => {
    const parts: Part[] = [{ text: "Explain the rule. ", role: "target" }, { text: "https://example.org/rule?v=2", role }];
    expect(() => parseResearchPlan(parts.map(part => part.text).join(""), proposal(parts))).toThrow(ResearchPlanningError);
  });

  it("refuses a URL split between scope spans", () => {
    const parts: Part[] = [{ text: "Explain it. ", role: "target" },
      { text: "https://example.org/", role: "scope" }, { text: "rule?v=2", role: "scope" }];
    expect(() => parseResearchPlan(parts.map(part => part.text).join(""), proposal(parts))).toThrow(ResearchPlanningError);
  });

  it("keeps every requested target and refuses nine instead of truncating", () => {
    const parts: Part[] = Array.from({ length: 9 }, (_, i) => ({ text: `Requested fact ${i}? `, role: "target" }));
    const question = parts.map(part => part.text).join("");
    expect(() => parseResearchPlan(question, proposal(parts))).toThrow(/exceeded 8 targets/);
    expect(parseResearchPlan(parts.slice(0, 8).map(part => part.text).join(""), proposal(parts.slice(0, 8)))).toHaveLength(8);
  });

  it.each([
    { claims: ["An extra model-written requirement?"] },
    { comparison: { parts: [] } },
    { constraints: ["An extra model-written requirement"] },
  ])("refuses mixed/foreign scope rather than discarding it: %j", extra => {
    expect(() => parseResearchPlan(population, { ...proposal([{ text: population, role: "target" }]), ...extra })).toThrow(ResearchPlanningError);
  });

  it("does not retry malformed caller scope through another model tier", async () => {
    const primary = new PlanningEngine([proposal([{ text: population + " Added requirement?", role: "target" }])]);
    const fallback = new PlanningEngine([proposal([{ text: population, role: "target" }])]);
    const alternate = vi.spyOn(fallback, "decompose");
    const engine = new ResilientEngine(primary, fallback, 0, new MemoryReasoningCircuitStore());
    await expect(engine.decompose(population)).rejects.toMatchObject({ reason: "invalid_output" });
    expect(primary.packets).toHaveLength(1);
    expect(alternate).not.toHaveBeenCalled();
  });
});
