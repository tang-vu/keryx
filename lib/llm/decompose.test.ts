import { describe, expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";

class PlanningFixture extends JsonChatEngine {
  readonly name = "planning-fixture";
  constructor(private output: Record<string, unknown>) { super(); }
  protected async chatJson() { return this.output; }
}

describe("research planning response boundaries", () => {
  it.each([{ claims: "patent formula" }, { claims: [null, 12, {}, " ", "x".repeat(601)] }, {}])(
    "retains the original question when provider output has no usable targets: %j", async (output) => {
      const question = "How does citation-weighted settlement work?";
      expect(await new PlanningFixture(output).decompose(question)).toEqual([question]);
    },
  );
  it("keeps distinct usable targets in order and bounds their number", async () => {
    const engine = new PlanningFixture({ claims: [" A? ", "A?", false, "B?", "C?", "D?", "E?"] });
    expect(await engine.decompose("question")).toEqual(["A?", "B?", "C?", "D?"]);
  });
});
