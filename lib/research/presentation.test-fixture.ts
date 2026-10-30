import type { QueryRun } from "../types";
export const presentationQuestions = { ar: "أجب بالعربية. اشرح x402.", en: "Answer in English. Explain x402.", vi: "Trả lời bằng tiếng Việt. Giải thích x402.",
  pt: "Responda em português. Explique x402.", es: "En español, explique x402.", fr: "Répondez en français. Expliquez x402.",
  "zh-Hans": "请用简体中文回答。解释 x402。", de: "Antworte bitte auf Deutsch. Erkläre x402.",
  ja: "日本語で回答してください。x402を説明してください。", ko: "한국어로 답변해 주세요. x402를 설명해 주세요.",
  hi: "कृपया हिंदी में उत्तर दें। x402 समझाएँ।", id: "Tolong jawab dalam bahasa Indonesia. Jelaskan x402.", ru: "Ответьте по-русски. Объясните x402." } as const;
export function presentationRun(question: string = presentationQuestions.en): QueryRun {
  const source = { sourceId: "source-original", sourceName: "Source 日本語 & <original>", itemId: "article-original",
    itemUrl: "https://example.invalid/original", contentVersion: "sha256:" + "a".repeat(64) };
  const quote = 'Exact “quote” <unmodified> & 日本語\r\nline two [S9]';
  return { id: "language-fixture", question, budget: 0.000001, engine: "heuristic", subClaims: ["Unverified original topic"], decisions: [],
    answer: quote + " [S1]", citations: [{ ...source, marker: "S1", weight: 1, reward: 0.000001, rationale: "Original rationale" }],
    evidence: [{ ...source, claimIndex: 0, claim: "Unverified original topic", marker: "S1", quote,
      support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false }],
    claimCoverage: [{ claimIndex: 0, claim: "Unverified original topic", coverage: 0.8, coveredBy: ["S1"] }],
    totalSpent: 0.000001, totalToCreators: 0.000001, paymentMode: "offline", paymentAttempts: 1, settledPayments: 0,
    trace: [], createdAt: "2026-10-12T00:00:00.000Z", confidence: { level: "Low", reason: "Original assessment" },
    reasoningAttempts: [{ step: "decide", engine: "heuristic", tier: 1, attempt: 1, startedAt: 1, durationMs: 0, outcome: "served" },
      { step: "synthesize", engine: "llm:original", tier: 0, attempt: 1, startedAt: 2, durationMs: 1, outcome: "failed", error: "output_validation", outputTokenLimit: 2560 }],
  };
}
