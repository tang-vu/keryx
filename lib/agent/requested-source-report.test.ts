import { describe, expect, it } from "vitest";
import type { GatheredContent } from "../llm";
import type { EvidenceRecord } from "../types";
import { requestedSources } from "../web-research/requested-sources";
import { requestedSourceReport } from "./requested-source-report";

const original = "https://developer.mozilla.org/en-US/docs/Web/API/AbortController#examples";
function input() {
  const requested = requestedSources(`Use ${original}`);
  return { candidates: requested.candidates, notices: requested.notices,
    decisions: [], gathered: [] as GatheredContent[], evidence: [] as EvidenceRecord[],
    outcomes: [], vi: false, withheld: false };
}
function read(qualified: boolean, truncated = false): ReturnType<typeof input> {
  const result = input(), [id, candidate] = [...result.candidates][0];
  result.gathered.push({ assetId: id, sourceId: id, sourceName: candidate.name,
    marker: "S1", text: "Exact retained original text.", itemUrl: candidate.item!.itemUrl,
    webProvenance: { retrievedAt: "2026-10-13T00:00:00.000Z", publisherGroup: "developer.mozilla.org",
      normalizedBodyHash: "synthetic-exact-body-hash", extraction: "html", truncated } });
  result.evidence.push({ claimIndex: 0, claim: "Synthetic bounded evidence", marker: "S1",
    sourceId: id, sourceName: candidate.name, quote: result.gathered[0].text,
    support: 1, qualifiesForAnswer: qualified, qualifiesForReward: false });
  return result;
}

describe("supplied original operational labels", () => {
  it("distinguishes an observed heading section from whole-document fallback", () => {
    const value = read(true, true);
    value.gathered[0].webProvenance!.htmlSectionScope = { format: "keryx-html-section-scope-v1", fragment: "examples", headingLevel: 2,
      htmlStart: 42, htmlEnd: 900, documentCharacters: 1100, documentSha256: "a".repeat(64) };
    expect(requestedSourceReport(value)).toContain("Only heading section `#examples` was read");
    expect(requestedSourceReport(value)).not.toContain("not that section specifically");
    expect(requestedSourceReport({ ...value, vi: true })).toContain("Chỉ đọc mục");
    expect(requestedSourceReport({ ...value, language: "pt" })).toContain("Foi lida apenas a seção");
  });
  it("does not claim a whole-document or section read for unread originals", () => {
    const english = "### Supplied original source status\n\n" +
      `- \`${original}\`: Not read: A read did not complete within this run's limits.` +
      " A section fragment was supplied; a read of the requested section has not been established.";
    const vietnamese = "### Trạng thái nguồn gốc đã cung cấp\n\n" +
      `- \`${original}\`: Chưa đọc: Chưa hoàn tất lượt đọc trong giới hạn lượt này.` +
      " URL có phần neo; chưa xác nhận đã đọc được mục được yêu cầu.";
    expect(requestedSourceReport(input())).toBe(english);
    expect(requestedSourceReport({ ...input(), language: "en" })).toBe(english);
    expect(requestedSourceReport({ ...input(), language: "es" })).toBe(english);
    expect(requestedSourceReport({ ...input(), vi: true })).toBe(vietnamese);
    expect(requestedSourceReport({ ...input(), vi: true, language: "vi" })).toBe(vietnamese);
  });

  it.each([true, false])("reports observed qualification=%s in Portuguese without changing retained bytes", qualified => {
    const data = read(qualified, true), before = structuredClone(data.gathered);
    const report = requestedSourceReport({ ...data, language: "pt" });
    expect(report).toContain("### Estado das fontes originais fornecidas");
    expect(report).toContain(qualified ? "trechos qualificados preservados" : "nenhuma evidência qualificada preservada");
    expect(report).toContain("A extração foi truncada.");
    expect(report).toContain("não daquela seção em particular.");
    expect(report).toContain(`\`${original}\``);
    expect(report).not.toContain("Supplied original source status");
    expect(data.gathered).toEqual(before);
    expect(data.evidence[0].quote).toBe("Exact retained original text.");
    expect(data.evidence[0].qualifiesForReward).toBe(false);
  });

  it("keeps withheld and abstract-only scope explicit", () => {
    const data = read(true);
    data.gathered[0].publicDeliveryKind = "abstract";
    expect(requestedSourceReport({ ...data, language: "pt" })).toContain(
      "Apenas a página do resumo foi lida; a evidência do artigo completo não está disponível.");
    const withheld = requestedSourceReport({ ...data, language: "pt", withheld: true });
    expect(withheld).toContain("Não lida: o acesso a documentos externos está desativado no escopo desta execução.");
    expect(withheld).not.toContain("Texto extraído");
  });

  it("preserves bounded diagnostic codes, rationale, notice reasons and URL escaping", () => {
    const data = input(), [id] = data.candidates.keys();
    const failed = requestedSourceReport({ ...data, language: "pt",
      outcomes: [{ assetId: id, name: "Original", code: "html-extraction-unavailable" }] });
    expect(failed).toContain("Falha na leitura: html-extraction-unavailable.");
    const skipped = requestedSourceReport({ ...data, language: "pt", decisions: [{
      sourceId: id, sourceName: "Original", action: "SKIP", rationale: "Exact operational reason.",
      expectedValue: 0, price: 0, confidence: 0, targets: [],
    }] });
    expect(skipped).toContain("SKIP: Exact operational reason.");
    const notice = requestedSourceReport({ ...input(), candidates: new Map(), language: "pt",
      notices: [{ url: "https://example.org/`[S9]", reason: "Exact original diagnostic reason." }] });
    expect(notice).toContain("`https://example.org/%60[\u200bS9]`: Exact original diagnostic reason.");
    expect(requestedSourceReport({ ...input(), candidates: new Map(), language: "pt" })).toBe("");
  });
});
