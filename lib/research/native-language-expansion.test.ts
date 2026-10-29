import { describe, expect, it } from "vitest";
import { nativeAnswerInstructions } from "./native-answer-intent";
import { answerPresentation } from "./answer-presentation";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pdfReadingCopy } from "../../locales/en/pdf-reading";
import { pdfReadingGerman } from "../../locales/de/pdf-reading";
import { pdfReadingJapanese } from "../../locales/ja/pdf-reading";
import { pdfReadingKorean } from "../../locales/ko/pdf-reading";
import { pdfReadingHindi } from "../../locales/hi/pdf-reading";
import { pdfReadingIndonesian } from "../../locales/id/pdf-reading";

const instructions = (question: string) => nativeAnswerInstructions(question.normalize("NFC"));
const last = (question: string) => instructions(question).filter(row => row.eligible).at(-1)?.language;

it.each([["de", pdfReadingGerman], ["ja", pdfReadingJapanese], ["ko", pdfReadingKorean],
  ["hi", pdfReadingHindi], ["id", pdfReadingIndonesian]] as const)("prepares exact bound %s PDF scope copy without activating it", (locale, copy) => {
  const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/pdf-reading.json`, "utf8"));
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
  const source = readFileSync(draft.sourcePath, "utf8").replace(/\r\n?/gu, "\n");
  expect(createHash("sha256").update(source).digest("hex")).toBe(draft.sourceSha256);
  expect(Object.isFrozen(copy)).toBe(true);
  expect(Object.keys(copy).sort()).toEqual(Object.keys(pdfReadingCopy).sort());
  const fields = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort();
  for (const key of Object.keys(pdfReadingCopy) as (keyof typeof pdfReadingCopy)[]) {
    expect(copy[key]).toBe(draft.entries[key].text);
    expect(draft.entries[key].source).toBe(pdfReadingCopy[key]);
    expect(fields(copy[key])).toEqual(fields(pdfReadingCopy[key]));
  }
  expect(copy.recovery).toContain("OCR");
});

describe("prepared finite native directives, before consumer enrollment", () => {
  it.each([
    ["de", "Answer in German. Explain the exact original."],
    ["de", "Please reply using German. Explain the exact original."],
    ["de", "Antworte bitte auf Deutsch. Explain the exact original."],
    ["de", "Auf Deutsch, erkläre die Originalquelle."],
    ["ja", "Answer in Japanese. Explain the exact original."],
    ["ja", "日本語で回答してください。元の資料を説明してください。"],
    ["ja", "日本語で答えてください。"],
    ["ko", "Reply in Korean. Explain the exact original."],
    ["ko", "한국어로 답변해 주세요. 원문을 설명해 주세요."],
    ["ko", "한국어로 대답해주세요."],
    ["hi", "Write in Hindi. Explain the exact original."],
    ["hi", "कृपया हिंदी में उत्तर दें। मूल सामग्री समझाएँ।"],
    ["hi", "हिन्दी में जवाब दीजिए।"],
    ["id", "Respond using Indonesian. Explain the exact original."],
    ["id", "Tolong jawab dalam bahasa Indonesia. Jelaskan sumber asli."],
    ["id", "Mohon tulis dengan bahasa Indonesia."],
  ] as const)("recognizes %s original output instruction %s", (language, question) => {
    const before = question;
    expect(last(question)).toBe(language);
    const row = instructions(question).find(row => row.eligible)!;
    expect(row.index).toBe(0); expect(row.end).toBeLessThanOrEqual(question.length);
    expect(question).toBe(before);
  });
  it.each([
    'Read "Answer in Japanese."', 'Read “A title. Reply in Korean.”',
    'Read „A title. Antworte auf Deutsch.“', 'Read »A title. Auf Deutsch, bitte.«',
    'Read 「日本語で回答してください。」', 'Read 『한국어로 답변해 주세요.』',
    'Read «हिंदी में उत्तर दें।»', 'Read `Tolong jawab dalam bahasa Indonesia.`',
    "Do not\nanswer in Japanese.", "Don't please reply in Korean.",
    "Nicht\nauf Deutsch.", "Jangan\ntolong jawab dalam bahasa Indonesia.",
    "मत\nहिंदी में उत्तर दें।", "日本語で回答しないでください。", "한국어로 답변하지 마세요.",
    "The source mentions Answer in Hindi as an example.", "Answer in Japanese-American English.",
    "Explain what an Indonesian source said.",
  ])("keeps quoted, negated, partial or mentioned output outside enrollment: %s", question => {
    expect(last(question)).toBeUndefined();
  });
  it.each([
    ["de", "en", "Antworte auf Deutsch. Antworte auf Englisch."],
    ["ja", "en", "日本語で回答してください。英語で回答してください。"],
    ["ko", "en", "한국어로 답변해 주세요. 영어로 답변해 주세요."],
    ["hi", "en", "हिंदी में उत्तर दें। अंग्रेज़ी में उत्तर दें।"],
    ["id", "en", "Jawab dalam bahasa Indonesia. Jawab dalam bahasa Inggris."],
    ["de", "ja", "Answer in German. 日本語で回答してください。"],
  ] as const)("keeps request order %s then %s", (first, final, question) => {
    expect(instructions(question).filter(row => row.eligible).map(row => row.language)).toEqual([first, final]);
    expect(last(question)).toBe(final);
  });
  it("retains refused spans for suppression without granting their language", () => {
    const question = 'Read “A title. Answer in Japanese.”';
    const spans = instructions(question);
    expect(spans).toHaveLength(1); expect(spans[0].eligible).toBe(false);
    expect(question.slice(spans[0].index, spans[0].end)).toBe("Answer in Japanese");
  });
  it("bounds scans and recognizes a later positive clause after a negative sentence", () => {
    expect(instructions(" ".repeat(30_000) + "Answer in Japanese.")).toEqual([]);
    expect(last("No thanks. Answer in German.")).toBe("de");
    expect(last("No thanks\nAnswer in Korean.")).toBe("ko");
  });
  it.each(["Answer in German.", "Answer in Japanese.", "Reply in Korean.", "Write in Hindi.", "Respond in Indonesian."])(
    "does not advertise prepared grammar as a connected ordinary producer: %s", question => {
      expect(answerPresentation(question)).toEqual({ language: "en" });
    });
});
