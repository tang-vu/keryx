import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/issue-238-mdn-button.json";
import { evidenceContext, selectEvidencePassages } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";
import type { GatheredContent } from "./reasoning-engine";
import { bodyIdentity, publisherGroup } from "../web-research/url-identity";

describe("bounded enumerated evidence context", () => {
  it("keeps the actual Portuguese MDN submit/default rule with reset/button", () => {
    // Full frozen extracted body and the actual question/four targets from #238.
    // This replays source selection only, without HTML retrieval or model calls.
    expect(createHash("sha256").update(fixture.text).digest("hex")).toBe(fixture.contentVersion);
    expect(bodyIdentity(fixture.text)).toBe(fixture.normalizedBodyHash);
    expect(fixture.text.slice(fixture.missingOriginalSpan.start, fixture.missingOriginalSpan.end))
      .toBe(fixture.missingOriginalSpan.text);
    const selection = selectEvidencePassages(fixture.text, fixture.question, fixture.subClaims, [fixture.sourceUrl], "html");
    const rules = fixture.text.slice(5280, 5712);
    expect(selection.passages.some(passage => passage.start <= 5280 && passage.end >= 5712 && passage.text.includes(rules))).toBe(true);
    expect(selection.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    expect(selection.candidateSelection!.nominated).toBeLessThanOrEqual(Math.ceil(fixture.text.length / 400) * 6 + 1);
    expect(selection.candidateSelection!.retained).toBeLessThanOrEqual(1 + 5 * 16);
    for (const passage of selection.passages) expect(passage.text).toBe(fixture.text.slice(passage.start, passage.end));

    const gathered: GatheredContent[] = [{ sourceId: "mdn-pt-button", sourceName: "MDN", marker: "S1",
      sourceKind: "public-reference", itemUrl: fixture.sourceUrl, text: fixture.text, contentVersion: fixture.contentVersion,
      webProvenance: { retrievedAt: fixture.capturedAt, publisherGroup: publisherGroup(fixture.sourceUrl),
        normalizedBodyHash: fixture.normalizedBodyHash, extraction: "html", truncated: false } }];
    const context = evidenceContext(fixture.question, fixture.subClaims, gathered);
    const options = buildQuoteOptions(context, gathered);
    for (const exact of [
      "submit: O botão envia os dados do formulário para o servidor.",
      "Esse é o padrão se o atributo não for especifidado, ou se o atributo é dinamicamente mudado para um valor vazio ou inválido.",
      "reset: O botão restaura todos os controles para seus valores iniciais.",
      "button: O botão não possui comportamento padrão.",
    ]) expect(options.some(option => option.text === exact)).toBe(true);
    for (const option of options) {
      expect(option.text).toBe(fixture.text.slice(option.start, option.end));
      expect(option.text.length).toBeLessThanOrEqual(240);
    }
    // Replacing a contiguous passage with text glued across omitted blocks cannot
    // become a server quote, even if each individual line exists in the source.
    const forged = [{ ...context[0], passages: [{ start: 5280, end: 5712,
      text: fixture.missingOriginalSpan.text + fixture.text.slice(5534, 5712) }] }];
    expect(() => buildQuoteOptions(forged, gathered)).toThrow(/passage text mismatch/);
  });

  it("bounds dense labeled lists and still retains a late short rule group", () => {
    const rules = fixture.text.slice(5280, 5712);
    const text = "k: Intro.\n".repeat(18_000) + "\n" + rules + "\n" + "k: Footer.\n".repeat(3000);
    const targets = ["submit", "reset", "button"];
    const selection = selectEvidencePassages(text, targets.join(" "), targets);
    expect(selection.scannedCharacters).toBe(200_000);
    expect(selection.passages.some(passage => passage.text.includes(rules))).toBe(true);
    expect(selection.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    expect(selection.passages.length).toBeLessThanOrEqual(9);
    expect(selection.candidateSelection!.nominated).toBeLessThanOrEqual(500 * 5 + 1);
    expect(selection.candidateSelection!.retained).toBeLessThanOrEqual(1 + 4 * 16);
    for (const passage of selection.passages) {
      expect(passage.end).toBeLessThanOrEqual(200_000);
      expect(passage.text).toBe(text.slice(passage.start, passage.end));
    }
  });
});
