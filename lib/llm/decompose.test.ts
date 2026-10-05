import { describe, expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { ResearchPlanningError } from "./research-plan";

class PlanningFixture extends JsonChatEngine {
  readonly name = "planning-fixture";
  constructor(private output: Record<string, unknown>) { super(); }
  protected async chatJson() { return this.output; }
}

describe("research planning response boundaries", () => {
  it.each([{ claims: "patent formula" }, { claims: [null, 12, {}, " ", "x".repeat(601)] }, {}])(
    "refuses malformed plans instead of hiding all requested dimensions in the original question: %j", async (output) => {
      const question = "How does citation-weighted settlement work?";
      await expect(new PlanningFixture(output).decompose(question)).rejects.toBeInstanceOf(ResearchPlanningError);
    },
  );
  it("preserves eight distinct usable targets in order after exact duplicate removal", async () => {
    const targets = ["How are jobs journaled?", "How are jobs recovered?", "How are payments authorized?",
      "How are citations verified?", "How are users authenticated?", "How is private data protected?",
      "How are results exported?", "How are releases deployed?"];
    const engine = new PlanningFixture({ claims: [` ${targets[0]} `, targets[0], ...targets.slice(1)] });
    expect(await engine.decompose("Investigate the eight requested capabilities.")).toEqual(targets);
  });
  it("refuses nine distinct usable targets rather than silently discarding requested scope", async () => {
    const targets = ["Journaling?", "Recovery?", "Payment authorization?", "Citation verification?", "Authentication?",
      "Privacy?", "Exports?", "Deployment?", "Source ownership?"];
    const engine = new PlanningFixture({ claims: [...targets, targets[0]] });
    await expect(engine.decompose("Investigate all nine requested capabilities.")).rejects.toThrow("exceeded 8 targets");
  });
});
