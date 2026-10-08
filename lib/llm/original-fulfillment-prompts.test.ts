import { describe, expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE } from "./original-fulfillment-quality";
import type { SynthInput } from "./reasoning-engine";

class Recorder extends JsonChatEngine {
  readonly name = "offline-prompt-fixture";
  readonly requests: Array<{ system: string; user: string }> = [];
  protected async chatJson(_model: string, system: string, user: string) { this.requests.push({ system, user }); return {}; }
}
class QualityRecorder extends Recorder {
  protected synthesisGenerationGuidance(_input: SynthInput) { return ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE; }
}
describe("protected original generation guidance", () => {
  it("leaves sufficiency bytes unchanged and replaces only the new private generation contract", async () => {
    const input = { question: "Synthetic question", subClaims: ["Synthetic target"], gathered: [] };
    const ordinary = new Recorder(), quality = new QualityRecorder();
    await ordinary.sufficiency(input); await quality.sufficiency(input);
    expect(quality.requests[0]).toEqual(ordinary.requests[0]);
    await ordinary.synthesize(input); await quality.synthesize(input);
    expect(ordinary.requests[1].system).toContain("at most two options per research question");
    expect(quality.requests[1].system).toBe(ORIGINAL_FULFILLMENT_GENERATION_GUIDANCE);
    expect(quality.requests[1].user).toBe(ordinary.requests[1].user);
    expect(Buffer.byteLength(quality.requests[1].system)).toBeLessThan(Buffer.byteLength(ordinary.requests[1].system));
  });
});
