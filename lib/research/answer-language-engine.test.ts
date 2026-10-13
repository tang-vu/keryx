import { expect, it } from "vitest";
import { JsonChatEngine } from "../llm/json-chat-engine";
import type { SynthInput } from "../llm/reasoning-engine";
import { reviewedStatementLanguage } from "./answer-language-review";

class SyntheticEngine extends JsonChatEngine {
  readonly name = "synthetic-language-observation";
  packets: { system: string; packet: Record<string, unknown> }[] = [];
  protected async chatJson(_model: string, system: string, user: string) {
    const packet = JSON.parse(user); this.packets.push({ system, packet });
    if (this.packets.length === 2) return { reviews: [{ index: 0, support: 0.9, statementSupport: 0.9, statementLanguage: "vi" }] };
    const option = (packet.quoteOptions as { quoteId: string; marker: string }[])[0];
    return { evidence: [{ claimIndex: 0, marker: option.marker, quoteId: option.quoteId, support: 0.9,
      statement: "Quy tắc có một giới hạn được nêu rõ." }], conflicts: [] };
  }
}
const base: SynthInput = { question: "Explain the bounded policy.", subClaims: ["What does the policy require?"],
  gathered: [{ sourceId: "synthetic", sourceName: "Synthetic source", marker: "S1", sourceKind: "public-reference",
    text: "The synthetic policy requires one documented safeguard." }], generationFormat: "evidence-only", answerPresentation: { language: "vi" } };

it("observes actual statement language in the same existing review call only after trusted ordinary opt-in", async () => {
  const ordinary = new SyntheticEngine();
  const result = await ordinary.synthesize({ ...base, observeAnswerLanguage: true });
  expect(ordinary.packets).toHaveLength(2);
  expect(ordinary.packets[1].system).toContain("a requested language or prompt does not prove");
  expect(ordinary.packets[1].packet.schema).toContain("statementLanguage");
  expect(reviewedStatementLanguage(result.evidence[0])).toBe("vi");
  const legacy = new SyntheticEngine();
  const historical = await legacy.synthesize(base);
  expect(legacy.packets).toHaveLength(2);
  expect(legacy.packets[1].system).not.toContain("statementLanguage");
  expect(legacy.packets[1].packet.schema).not.toContain("statementLanguage");
  expect(reviewedStatementLanguage(historical.evidence[0])).toBeUndefined();
});
