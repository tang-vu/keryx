import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ingestRssXml } from "../ingest/rss";
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
  it("keeps both journaling and GET-only recovery for the English paid-pilot question", async () => {
    const feed = await ingestRssXml(readFileSync("docs/engineering/feed.xml", "utf8"), "https://example.test/feed");
    const article = feed.items.find(item => item.title === "Recovering a Keryx paid research job")!;
    const result = selectEvidencePassages(article.content,
      "How does the Keryx buyer journal a job before submission, and how can it recover after losing the response without paying again? Use the Keryx Engineering source for the documented behavior.",
      ["How does the Keryx buyer journal a job before submission?", "How can the Keryx buyer recover after losing the response without paying again?"]);
    for (const quote of [
      "Before signing, the journal records the normalized request, payment terms, nonce and deterministic job identifier.",
      "Resume sends only GET requests for the original job.",
      "It does not sign a new authorization or replay a purchase.",
    ]) expect(result.passages.some(p => p.text.includes(quote))).toBe(true);
    expect(result.passages.reduce((sum, p) => sum + p.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const p of result.passages) expect(p.text).toBe(article.content.slice(p.start, p.end));
  });
  it("keeps receipt integrity evidence when a second target asks for absent SQL details", async () => {
    const feed = await ingestRssXml(readFileSync("docs/engineering/feed.xml", "utf8"), "https://example.test/feed");
    const article = feed.items.find(item => item.title === "Recovering a Keryx paid research job")!;
    const result = selectEvidencePassages(article.content,
      "How does Keryx verify a research receipt, and which SQL isolation level does its buyer journal use?",
      ["How does Keryx verify a research receipt?", "Which SQL isolation level does Keryx's buyer journal use?"]);
    expect(result.passages.some(p => p.text.includes("canonical SHA-256 digest"))).toBe(true);
    expect(result.passages.some(p => p.text.includes("original question and returned answer"))).toBe(true);
    expect(result.passages.reduce((sum, p) => sum + p.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const p of result.passages) expect(p.text).toBe(article.content.slice(p.start, p.end));
  });
  it("keeps recovery instructions that overlap an already selected journal passage", async () => {
    const feed = await ingestRssXml(readFileSync("docs/engineering/feed.xml", "utf8"), "https://example.test/feed");
    const article = feed.items.find((item) => item.title === "Recovering a Keryx paid research job")!;
    const result = selectEvidencePassages(article.content,
      "How can a Keryx buyer recover a job after losing the submission response without paying again?",
      ["How does the buyer preserve the original job before submission?", "What does resume do after response loss, and what payment actions does it avoid?"]);
    expect(result.passages.some((p) => p.text.includes("Resume sends only GET requests for the original job."))).toBe(true);
    expect(result.passages.reduce((sum, p) => sum + p.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const passage of result.passages) expect(passage.text).toBe(article.content.slice(passage.start, passage.end));
  });
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

  it.each([390, 590, 790, 1190, 1590, 1990, 2390])("keeps a complete relevant sentence near a window edge at %i", (offset) => {
    const sentence = "Receipt integrity is checked against the original request.";
    const prefix = "Unrelated background. ".repeat(Math.floor(offset / 22)).padEnd(offset, " ");
    const text = prefix + sentence + " General appendix. ".repeat(150);
    const result = selectEvidencePassages(text, "How is receipt integrity checked?", ["How is receipt integrity checked?"]);
    expect(result.passages.some(p => p.text.includes(sentence))).toBe(true);
    expect(result.passages.reduce((sum, p) => sum + p.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const [index, p] of result.passages.entries()) {
      expect(p.text).toBe(text.slice(p.start, p.end));
      if (index) expect(p.start).toBeGreaterThan(result.passages[index - 1].end);
    }
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
