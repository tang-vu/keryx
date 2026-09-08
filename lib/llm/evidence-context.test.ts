import { describe, expect, it } from "vitest";
import { evidenceContext, selectEvidencePassages } from "./evidence-context";
import { JsonChatEngine } from "./json-chat-engine";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import type { GatheredContent } from "./reasoning-engine";

const question = "What does the HTTP 402 response contain and how does an agent retry?";
const claims = ["What payment requirements are returned by HTTP 402?", "How does an agent sign and retry?"];
const quote = "The HTTP 402 response contains payment requirements. The agent signs a payment authorization and retries the original request.";
const longText = "Release history and unrelated maintenance notes. ".repeat(130) + "\n\n" + quote + "\n\n" + "Appendix and acknowledgements. ".repeat(60);
const gathered: GatheredContent[] = [{ sourceId: "test", sourceName: "Fixture", marker: "S1", text: longText }];

describe("bounded evidence context", () => {
  it("recovers late evidence without rewriting source text or exceeding the old synthesis text budget", () => {
    expect(longText.slice(0, 2000)).not.toContain(quote);
    const result = selectEvidencePassages(longText, question, claims);
    expect(result.passages.some((passage) => passage.text.includes(quote))).toBe(true);
    expect(result.passages.reduce((total, passage) => total + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const passage of result.passages) expect(passage.text).toBe(longText.slice(passage.start, passage.end));
    expect(result.passages[0].start).toBe(0);
    expect(result.excerpted).toBe(true);
    const ledger = buildEvidenceLedger({
      subClaims: claims, gathered, answer: "The server sends payment requirements [S1].", declaredMarkers: ["S1"],
      proposedEvidence: [{ marker: "S1", claimIndex: 0, quote, support: 0.9 }],
      finalAssessment: claims.map((claim) => ({ claim, coverage: 0.9, coveredBy: ["S1"] })),
    });
    expect(ledger.evidence[0].qualifiesForReward).toBe(true);
  });

  it("keeps short abstracts intact and does not invent full-text provenance", () => {
    const context = evidenceContext(question, claims, [{ ...gathered[0], text: "A short abstract.", contentReceipt: {
      deliveryKind: "abstract", storageMode: "db_encrypted", plaintextBytes: 17,
    } }])[0];
    expect(context.deliveryKind).toBe("abstract");
    expect(context.excerpted).toBe(false);
    expect(context.passages).toEqual([{ start: 0, end: 17, text: "A short abstract." }]);
    expect(evidenceContext(question, claims, gathered)[0].deliveryKind).toBe("unknown");
  });

  it("retains distinct late targets instead of spending every window on the same repeated keyword", () => {
    const text = "Introduction. ".repeat(180) + "\n" + "Apple orchard pruning advice. ".repeat(40) +
      "\n" + "Background. ".repeat(150) + "\nSolar battery storage capacity is measured in kilowatt-hours.\n" + "Ending. ".repeat(90);
    const result = selectEvidencePassages(text, "orchard pruning and solar battery storage", ["orchard pruning", "solar battery storage"]);
    expect(result.passages.some((p) => p.text.includes("orchard pruning"))).toBe(true);
    expect(result.passages.some((p) => p.text.includes("Solar battery storage"))).toBe(true);
  });

  it("makes the scan limit explicit and stays bounded for empty or unmatched requests", () => {
    expect(selectEvidencePassages("", "", []).passages).toEqual([]);
    const result = selectEvidencePassages("z".repeat(220_000), "", []);
    expect(result).toMatchObject({ originalCharacters: 220_000, scannedCharacters: 200_000, excerpted: true });
    expect(result.passages).toHaveLength(1);
  });

  it("gives assessment, re-evaluation and synthesis identical source passages", async () => {
    const payloads: Record<string, unknown>[] = [];
    class CaptureEngine extends JsonChatEngine {
      readonly name = "capture";
      protected async chatJson(_model: string, _system: string, user: string) {
        payloads.push(JSON.parse(user)); return {};
      }
    }
    const engine = new CaptureEngine();
    const input = { question, subClaims: claims, gathered };
    await engine.sufficiency(input);
    await engine.reevaluate({ ...input, skippedSources: [], remainingBudget: 0 });
    await engine.synthesize(input);
    expect(payloads[0].gathered).toEqual(payloads[1].gathered);
    expect(payloads[0].gathered).toEqual(payloads[2].sources);
    expect(JSON.stringify(payloads[0].gathered)).toContain(quote);
  });
});
