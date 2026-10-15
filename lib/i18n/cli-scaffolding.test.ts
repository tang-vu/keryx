import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientPresentationLanguage, clientPresentationMessages } from "../../shared/i18n/client-language";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";
import { recordedAnswerLanguage } from "../research/answer-language-provenance";
import type { QueryRun } from "../types";
import { formatNumber, formatRecordedUsdc } from "./format";

// Read the executable as text; importing ask.mts would initialize providers and run research.
const ask = readFileSync(new URL("../../scripts/ask.mts", import.meta.url), "utf8");
const quote = "Original café\r\n“x402 / USDC” [S99] {question} $&";
const answer = `A bounded synthetic result.\n${quote}`;
const completedRun = (language: PresentationLanguage): Pick<QueryRun, "answer" | "trace"> => ({
  answer,
  trace: [{ phase: "done", ts: 0, message: "Done", detail: { answerLanguage: {
    format: "keryx-answer-language-v1", scope: "generated-prose", language,
    method: "deterministic-renderer",
    answerSha256: `0x${createHash("sha256").update(answer, "utf8").digest("hex")}`,
  } } }],
});

describe("bounded neutral CLI scaffolding", () => {
  it.each([
    [undefined, "en"], [null, "en"], ["", "en"], ["zh-Hans", "en"],
    ["en-US", "en"], ["VI_vn", "vi"], ["pt-BR", "pt"], ["es-MX", "es"],
  ] as const)("uses the existing system/default selection for %s", (system, expected) => {
    expect(clientPresentationLanguage(system)).toBe(expected);
    expect(clientPresentationLanguage(system, "auto")).toBe(expected);
  });

  it.each([
    ["en", "en"], ["vi", "vi"], ["pt", "pt"], ["pt-BR", "pt"], ["es", "es"],
  ] as const)("honors explicit %s over system language", (override, expected) => {
    expect(clientPresentationLanguage("vi-VN", override)).toBe(expected);
    expect(clientPresentationLanguage("zh-Hans", override)).toBe(expected);
  });

  it("retains refusal of unsupported explicit overrides", () => {
    for (const override of ["fr", "en-US", "", null, {}, 0]) {
      expect(() => clientPresentationLanguage("vi-VN", override)).toThrow("Unsupported presentation language");
    }
  });

  it.each([
    ["en", "engine", "source cap", "question", "run id"],
    ["vi", "bộ suy luận", "hạn mức nguồn", "câu hỏi", "mã lượt chạy"],
    ["pt", "motor", "limite para fontes", "pergunta", "id da execução"],
    ["es", "motor", "límite para fuentes", "pregunta", "id de ejecución"],
  ] as const)("provides all four neutral %s wrappers", (language, engine, sourceCap, question, runId) => {
    expect(clientPresentationMessages(language).controls).toMatchObject({ engine, sourceCap, question, runId });
  });

  it.each(["en", "vi", "pt", "es"] as const)("uses recorded %s for completed labels without rewriting answer/quote bytes", language => {
    const run = completedRun(language);
    const before = JSON.stringify(run);
    const selected = clientPresentationLanguage("vi-VN", "es");
    expect(clientPresentationMessages(selected).controls.question).toBe("pregunta");
    const result = clientPresentationMessages(recordedAnswerLanguage(run) ?? selected).controls;
    expect(result.runId).toBe(clientPresentationMessages(language).controls.runId);
    expect(result.answer).toBe(clientPresentationMessages(language).controls.answer);
    expect(Buffer.from(run.answer, "utf8").equals(Buffer.from(answer, "utf8"))).toBe(true);
    expect(run.answer.endsWith(quote)).toBe(true);
    expect(JSON.stringify(run)).toBe(before);
  });

  it("keeps missing, mutated, duplicate and unqualified records on the existing selected-language fallback", () => {
    const run = completedRun("pt");
    const step = run.trace[0];
    const packet = (step.detail as { answerLanguage: Record<string, unknown> }).answerLanguage;
    const invalidRuns = [
      { ...run, trace: [] },
      { ...run, answer: run.answer.normalize("NFD") },
      { ...run, trace: [...run.trace, ...run.trace] },
      ...[{ ...packet, format: "future" }, { ...packet, language: "fr" },
        { ...packet, humanApproved: true }, { language: "pt" }].map(answerLanguage => ({
        ...run, trace: [{ ...step, detail: { answerLanguage } }],
      })),
    ];
    for (const invalid of invalidRuns) {
      const before = JSON.stringify(invalid);
      expect(recordedAnswerLanguage(invalid)).toBeUndefined();
      for (const selected of ["en", "vi", "pt", "es"] as const) {
        expect(clientPresentationMessages(recordedAnswerLanguage(invalid) ?? selected).controls.runId)
          .toBe(clientPresentationMessages(selected).controls.runId);
      }
      expect(JSON.stringify(invalid)).toBe(before);
    }
  });

  it("wires only labels around the original engine, question, cap and run ID values", () => {
    for (const expression of [
      'const clientCopy = clientPresentationMessages(clientLanguage);',
      'console.log(`${c.dim(`${clientCopy.controls.engine}:`)} ${getReasoningEngine(model).name}`);',
      'console.log(`${c.dim(`${clientCopy.controls.sourceCap}:`)} ${budget ?? 0.05} USDC`);',
      'console.log(`${c.dim(`${clientCopy.controls.question}:`)} ${question}\\n`);',
      'const answerLanguage = recordedAnswerLanguage(run) ?? clientLanguage;',
      'const resultCopy = clientPresentationMessages(answerLanguage);',
      'console.log(c.bold(`\\n📝 ${resultCopy.controls.answer}\\n`));',
      'console.log(run.answer);',
      'console.log(c.dim(`\\n${resultCopy.controls.runId}: ${run.id}\\n`));',
    ]) expect(ask).toContain(expression);
    expect(ask.indexOf('clientCopy.controls.question')).toBeLessThan(ask.indexOf('const run = await collectRun('));
    expect(ask.indexOf('resultCopy.controls.runId')).toBeGreaterThan(ask.indexOf('const answerLanguage = recordedAnswerLanguage(run)'));
  });

  it("preserves micro-USDC and contribution formatting independently of label language", () => {
    expect(formatRecordedUsdc(0.000001, { denomination: "USDC" })).toBe("0.000001 USDC");
    expect(formatRecordedUsdc(1234.000001, { denomination: "USDC" })).toBe("1,234.000001 USDC");
    expect(formatNumber(0.25 * 100, { maximumFractionDigits: 0 })).toBe("25");
    for (const value of ["cit.reward", "run.totalSpent", "run.operatingFee.amountUsdc"]) {
      expect(ask).toContain(`formatRecordedUsdc(${value}, { denomination: "USDC" })`);
    }
    expect(ask).toContain('formatNumber(cit.weight * 100, { maximumFractionDigits: 0 })');
  });

  it("retains canonical English financial, provider disclosure and private-claim authority", () => {
    for (const call of [
      'console.log(c.bold(`\\n🏛  Keryx — citation-toll reading agent`));',
      'if (allowExternalWeb) console.log("Public web search may send this question to the configured search provider. The source USDC budget is separate from model and search operating costs.");',
      'console.log(c.bold("\\n💸 Planned citation allocations (USDC)"));',
      'console.log(c.dim("  (no citation allocations)"));',
      'c.bold(`\\n📊 Recorded source total: ${c.green(formatRecordedUsdc(run.totalSpent, { denomination: "USDC" }))}`)',
      'console.log(c.dim(`Payment mode: ${run.paymentMode === "offline" ? "offline simulation" : run.paymentMode ?? "unknown"}. Allocations and recorded totals do not prove settlement; inspect the original per-payment receipts.`));',
      'console.log(c.dim("Model and search operating costs are separate from the source cap and recorded source total."));',
      'if (run.operatingFee) console.log(`Keryx operating fee allocation: ${formatRecordedUsdc(run.operatingFee.amountUsdc, { denomination: "USDC" })} · ${run.operatingFee.status}. Separate from creator rewards; inspect the original payment ledger for settlement evidence.`);',
      'if (privateClaimStatus === "written") console.log(c.dim("Private account claim written once to the dedicated private pipe. Keep it private; lost delivery cannot be reissued."));',
      'if (privateClaimStatus === "unavailable") console.log(c.dim("The completed answer is saved, but its private account claim is unavailable. Do not repeat paid research to recover it."));',
      'console.error(researchFailureMessage(error));',
      'console.error(JSON.stringify({ selectionDiagnostic: error.diagnostic }))',
      '{ onStep: printStep }',
    ]) expect(ask).toContain(call);
  });
});
