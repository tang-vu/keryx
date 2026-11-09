import { describe, expect, it } from "vitest";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";
import { isCompleteEvidenceSpan } from "./evidence-span";
import type { GatheredContent } from "./reasoning-engine";
import { JsonChatEngine } from "./json-chat-engine";
import { buildEvidenceLedger } from "../agent/evidence-ledger";

// Synthetic retrieval controls, not empirical regulations or semantic reviews.
const padding = "Unrelated background material and acknowledgements. ".repeat(24);
const cases = [
  { language: "English", question: "What does rule 7 permit?",
    fact: "Rule 7 permits the synthetic operation within its original recorded boundary.",
    other: (id: number) => `Rule ${id} permits the synthetic operation within its boundary.`,
    condition: "It does not authorize another operation." },
  { language: "Vietnamese", question: "Quy định số 7 cho phép thực hiện gì?",
    fact: "Quy định số 7 cho phép thực hiện thao tác tổng hợp trong phạm vi đã ghi nhận.",
    other: (id: number) => `Quy định số ${id} cho phép thực hiện thao tác tổng hợp trong phạm vi gốc.`,
    condition: "Điều này không cho phép thao tác ngoài phạm vi." },
];

function fixture(row: typeof cases[number]): GatheredContent {
  const blocks = Array.from({ length: 40 }, (_, index) =>
    `${index === 26 ? row.fact : row.other(index + 10)} ${row.condition}`);
  return { marker: "S1", sourceId: "synthetic-numeric-retrieval", sourceName: "Synthetic numeric retrieval fixture",
    text: `${padding}\n\n${blocks.join(`\n\n${padding}\n\n`)}\n\n${padding}` };
}

describe("explicit one-digit source references", () => {
  it.each(cases)("keeps a late numbered fact and its restriction for a $language target", row => {
    const original = fixture(row);
    const selected = evidenceContext(row.question, [row.question], [original])[0];
    expect(selected.passages.some(passage => passage.text.includes(row.fact))).toBe(true);
    expect(selected.passages.some(passage => passage.text.includes(`${row.fact} ${row.condition}`))).toBe(true);
    expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    expect(selected.passages.length).toBeLessThanOrEqual(9);
    expect(selected.candidateSelection!.nominated).toBeLessThanOrEqual(Math.ceil(original.text.length / 400) * 3 + 1);
    expect(selected.candidateSelection!.retained).toBeLessThanOrEqual(33);
    for (const passage of selected.passages) expect(passage.text).toBe(original.text.slice(passage.start, passage.end));
    const quote = buildQuoteOptions([selected], [original]).find(option => option.text === row.fact);
    expect(quote).toBeDefined();
    expect(isCompleteEvidenceSpan(original, quote!.text, quote)).toBe(true);
  });

  it.each(["0", "9"])("retains a literal boundary digit %s with the same source budget", digit => {
    const row = cases[0], original = fixture(row);
    const fact = row.fact.replace("7", digit), question = row.question.replace("7", digit);
    const source = { ...original, text: original.text.replace(row.fact, fact) };
    const selected = evidenceContext(question, [question], [source])[0];
    expect(selected.passages.some(passage => passage.text.includes(`${fact} ${row.condition}`))).toBe(true);
    expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const passage of selected.passages) expect(passage.text).toBe(source.text.slice(passage.start, passage.end));
  });

  it.each(["７", "𝟟", "٧"])("binds compatible or matching Unicode digits to their exact original offsets: %s", digit => {
    const row = cases[0], original = fixture(row);
    const fact = row.fact.replace("7", digit), question = row.question.replace("7", digit);
    const source = { ...original, text: original.text.replace(row.fact, fact) };
    const selected = evidenceContext(question, [question], [source])[0];
    const quote = buildQuoteOptions([selected], [source]).find(option => option.text === fact)!;
    expect(quote).toBeDefined();
    expect(source.text.slice(quote.start, quote.end)).toBe(fact);
    expect(isCompleteEvidenceSpan(source, quote.text, quote)).toBe(true);
    expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  });

  it("keeps an already-supported multi-digit reference without aliasing an absent one-digit reference", () => {
    const row = cases[0], original = fixture(row), fact = row.fact.replace("7", "98");
    const source = { ...original, text: original.text.replace(row.fact, fact) };
    const question = row.question.replace("7", "98");
    expect(evidenceContext(question, [question], [source])[0].passages.some(passage => passage.text.includes(fact))).toBe(true);
    // Existing tokens such as17/27/37 and98 do not become the requested token7.
    expect(evidenceContext(row.question, [row.question], [source])[0].passages)
      .toEqual(evidenceContext(row.question.replace(" 7", ""), [row.question.replace(" 7", "")], [source])[0].passages);
  });

  it("does not generalize numeric retention to one-letter words or alter the short-source path", () => {
    const source = fixture(cases[0]);
    expect(evidenceContext("R", ["R"], [source])[0]).toEqual(evidenceContext("Q", ["Q"], [source])[0]);
    const short = { ...source, text: "Rule 7 permits only the synthetic operation." };
    expect(evidenceContext("Rule 7", [], [short])[0].passages).toEqual([{ start: 0, end: short.text.length, text: short.text }]);
    expect(evidenceContext(cases[0].question, [], [source])[0].passages)
      .toEqual(evidenceContext(cases[0].question, [cases[0].question], [source])[0].passages);
  });

  it("retains two independently requested numeric targets within the existing source and candidate bounds", () => {
    const row = cases[0], original = fixture(row);
    const second = row.other(30).replace("30", "3");
    const source = { ...original, text: original.text.replace(row.other(30), second) };
    const targets = [row.question, row.question.replace("7", "3")];
    const selected = evidenceContext("Explain rules 7 and 3", targets, [source])[0];
    for (const fact of [row.fact, second]) expect(selected.passages.some(passage => passage.text.includes(fact))).toBe(true);
    expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    expect(selected.passages.length).toBeLessThanOrEqual(9);
    expect(selected.candidateSelection!.nominated).toBeLessThanOrEqual(Math.ceil(source.text.length / 400) * 4 + 1);
    expect(selected.candidateSelection!.retained).toBeLessThanOrEqual(49);
  });

  it("uses the same numeric source context for all supplier stages and adds no factual admission", async () => {
    const row = cases[0], original = fixture(row), packets: Record<string, unknown>[] = [];
    class CaptureEngine extends JsonChatEngine {
      readonly name = "synthetic-numeric-context-control";
      protected async chatJson(_model: string, _system: string, user: string) {
        packets.push(JSON.parse(user)); return {};
      }
    }
    const engine = new CaptureEngine(), input = { question: row.question, subClaims: [row.question], gathered: [original] };
    await engine.sufficiency(input);
    await engine.reevaluate({ ...input, skippedSources: [], remainingBudget: 0 });
    const result = await engine.synthesize(input);
    expect(packets).toHaveLength(3);
    expect(packets[0].gathered).toEqual(packets[1].gathered);
    expect(packets[0].gathered).toEqual(packets[2].sources);
    expect(JSON.stringify(packets[2].sources)).toContain(row.fact);
    const options = packets[2].quoteOptions as { text: string }[];
    expect(options.some(option => option.text === row.fact)).toBe(true);
    expect(result.evidence).toEqual([]); expect(result.citedMarkers).toEqual([]); expect(result.answer).toBe("");
    const ledger = buildEvidenceLedger({ subClaims: [row.question], gathered: [original],
      answer: "An unsupported numerical outcome [S1].", declaredMarkers: ["S1"], proposedEvidence: [],
      finalAssessment: [{ claim: row.question, coverage: 1, coveredBy: ["S1"] }] });
    expect(ledger.acceptedMarkers.size).toBe(0);
  });
});
