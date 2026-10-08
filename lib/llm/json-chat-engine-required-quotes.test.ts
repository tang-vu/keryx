import { describe, expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import type { SufficiencyInput, SynthInput } from "./reasoning-engine";
import type { QuoteOption } from "./quote-options";

const input: SufficiencyInput = { question: "How is access controlled?", subClaims: ["How is access controlled?"],
  gathered: [{ sourceId: "synthetic-source", sourceName: "Synthetic fixture", marker: "S1", text: "The synthetic service checks the signature before granting access." }] };
class Capture extends JsonChatEngine {
  readonly name = "synthetic-menu-capture";
  payloads: Record<string, unknown>[] = [];
  protected async chatJson(_model: string, _system: string, user: string) {
    this.payloads.push(JSON.parse(user)); return {};
  }
}
describe("protected generation menu hook", () => {
  it("keeps ordinary quote payloads identical without private target metadata", async () => {
    const engine = new Capture(); await engine.synthesize(input);
    const options = engine.payloads[0].quoteOptions as object[];
    expect(options.length).toBeGreaterThan(0);
    for (const row of options) expect(Object.keys(row).sort()).toEqual(["marker", "quoteId", "text"]);
  });
  it("allows an explicit specialized engine to carry server-owned quote targets without changing sufficiency", async () => {
    class Specialized extends Capture {
      protected synthesisGenerationQuoteOptions(_input: SynthInput, options: QuoteOption[]) {
        return options.map(({ quoteId, marker, text }) => ({ quoteId, marker, text, claimIndex: 0 }));
      }
    }
    const ordinary = new Capture(), specialized = new Specialized();
    await ordinary.sufficiency(input); await specialized.sufficiency(input);
    expect(specialized.payloads[0]).toEqual(ordinary.payloads[0]);
    await specialized.synthesize(input);
    expect((specialized.payloads[1].quoteOptions as Array<{ claimIndex: number }>).every(row => row.claimIndex === 0)).toBe(true);
  });
});
