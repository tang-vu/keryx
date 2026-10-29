import { describe, expect, it } from "vitest";
import { botResearchEnglish } from "../../locales/en/bot-research";
import { botResearchCatalogues, botResearchFailure, botResearchMessages, type BotResearchMessageKey } from "./research-messages";
import { answerPresentation } from "../research/answer-presentation";
import { ResearchAdmissionHeldError, RESEARCH_PAUSED_MESSAGE } from "../research/availability-contract";
import { buildAnswerText as telegram, buildErrorText as telegramError } from "../telegram/ask-message";
import { buildAnswerText as slack, buildErrorText as slackError } from "../slack/ask-command";
import { buildAnswerMessage as discord, buildErrorMessage as discordError } from "../discord/ask-interaction";
import type { QueryRun } from "../types";

const requests = [
  ["en", "Answer in English. Explain x402.", "Citations and planned rewards (USDC)"],
  ["vi", "Trả lời bằng tiếng Việt. Giải thích x402.", "Trích dẫn và phần thưởng dự kiến (USDC)"],
  ["pt", "Responda em português. Explique x402.", "Citações e recompensas planejadas (USDC)"],
  ["es", "En español, explique x402.", "Citas y recompensas previstas (USDC)"],
  ["fr", "Répondez en français. Expliquez x402.", "Citations and planned rewards (USDC)"],
  ["zh-Hans", "请用简体中文回答。解释 x402。", "Citations and planned rewards (USDC)"],
  ["de", "Antworte bitte auf Deutsch. Erkläre x402.", "Citations and planned rewards (USDC)"],
  ["ja", "日本語で回答してください。x402を説明してください。", "Citations and planned rewards (USDC)"],
  ["ko", "한국어로 답변해 주세요. x402를 설명해 주세요.", "Citations and planned rewards (USDC)"],
  ["hi", "कृपया हिंदी में उत्तर दें। x402 समझाएँ।", "Citations and planned rewards (USDC)"],
  ["id", "Tolong jawab dalam bahasa Indonesia. Jelaskan x402.", "Citations and planned rewards (USDC)"],
] as const;
const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort();
function run(question: string, paymentMode?: "real" | "offline"): QueryRun {
  return { id: "synthetic-run", question, budget: 0.05, engine: "heuristic", subClaims: [], decisions: [],
    citations: [{ marker: "S1", sourceId: "source-1", sourceName: "Original & <creator>", weight: 1, reward: 0.000001, rationale: "original reason" }],
    answer: 'Original evidence: “Answer in Portuguese: <unchanged> & exact.” [S1]\nOriginal confidence and payment notice.',
    totalSpent: 0.000001, totalToCreators: 0.000001, trace: [], createdAt: "2026-10-11T00:00:00.000Z", paymentMode };
}

describe("ordinary bot catalogue", () => {
  it.each(Object.entries(botResearchCatalogues))("%s retains the closed key/parameter contract and canonical USDC", (_, catalogue) => {
    expect(Object.keys(catalogue).sort()).toEqual(Object.keys(botResearchEnglish).sort());
    expect(Object.isFrozen(catalogue)).toBe(true);
    for (const key of Object.keys(botResearchEnglish) as BotResearchMessageKey[]) {
      expect(catalogue[key].trim()).not.toBe("");
      expect(placeholders(catalogue[key])).toEqual(placeholders(botResearchEnglish[key]));
    }
    expect(catalogue.citationHeading).toContain("USDC");
    expect(catalogue.slackCitationHeading).toContain("USDC");
    expect(catalogue.discordUsage).toContain("`/ask question:<text>`");
  });
  it.each(requests)("%s selects from the trusted question with the existing answer selector", (language, question, heading) => {
    expect(answerPresentation(question, "ordinary").language).toBe(language);
    expect(botResearchMessages(question)("citationHeading")).toBe(heading);
  });
  it.each([
    "En español, explique sobre Arc para un lector.",
    "Answer in Portuguese. Answer in Spanish. Explain x402.",
    "Do not answer in Portuguese. Answer in Spanish. Explain x402.",
  ])("uses bounded directive precedence rather than shared vocabulary: %s", question => {
    expect(botResearchMessages(question)("citationHeading")).toBe(botResearchCatalogues.es.citationHeading);
  });
  it("falls back for unsupported directives and does not persist a previous request's language", () => {
    const spanish = botResearchMessages("Answer in Spanish. Explain x402.");
    const fallback = botResearchMessages("Answer in French. Explique uma coisa.");
    expect(fallback("citationHeading")).toBe(botResearchEnglish.citationHeading);
    expect(botResearchMessages()("citationHeading")).toBe(botResearchEnglish.citationHeading);
    expect(spanish("citationHeading")).toBe(botResearchCatalogues.es.citationHeading);
  });
  it("refuses invalid keys and omitted parameters rather than rendering broken labels", () => {
    // @ts-expect-error The runtime boundary also refuses untyped callers.
    expect(() => botResearchMessages()("unknown")).toThrow("Unknown bot research message");
    // @ts-expect-error A named value is mandatory.
    expect(() => botResearchMessages()("fullTrace")).toThrow("Missing bot research parameter");
  });
  it("uses localized product pause without exposing internal detail or changing its machine code", () => {
    const error = new ResearchAdmissionHeldError("private internal cause");
    expect(error.code).toBe("research_paused");
    expect(botResearchFailure(error, requests[3][1])).toContain(botResearchCatalogues.es.paused);
    expect(botResearchFailure(error, requests[3][1])).not.toContain("private internal cause");
    expect(botResearchFailure(error)).toContain(RESEARCH_PAUSED_MESSAGE);
  });
  it.each(requests)("%s preserves raw provider diagnostics with existing HTML/Slack escaping", (_, question) => {
    const detail = 'Original provider 日本語: "Answer in English" <tag> & {detail}';
    const error = new Error(detail);
    const prefix = botResearchMessages(question)("failure", { detail: "" });
    expect(discordError(error, question).content).toBe(prefix + detail);
    for (const text of [telegramError(error, question), slackError(error, question)]) {
      expect(text).toContain('Original provider 日本語: "Answer in English" &lt;tag&gt; &amp; {detail}');
      expect(text).toContain(prefix);
    }
  });
});

describe("bot result evidence and payment parity", () => {
  it.each(requests.flatMap(([, question]) => [undefined, "real", "offline"].map(paymentMode => [question, paymentMode] as const)))
    ("preserves original evidence, amount and raw %s/%s mode", (question, paymentMode) => {
      const original = run(question, paymentMode as "real" | "offline" | undefined);
      const before = JSON.stringify(original);
      const escapedAnswer = original.answer.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const embed = discord(original).embeds[0];
      expect(embed.description).toBe(original.answer);
      expect(embed.title).toBe(original.question);
      expect(embed.color).toBe(0xc0381c);
      expect(embed.fields[0].name).toBe(botResearchMessages(question)("citationHeading"));
      const language = answerPresentation(question, "ordinary").language;
      const amount = ["en", "zh-Hans", "ja", "ko", "hi"].includes(language) ? "$0.000001" : "$0,000001";
      expect(embed.fields[0].value).toContain(`Original & <creator> — ${amount}`);
      expect(embed.footer.text).toContain(`(${paymentMode ?? "legacy"})`);
      for (const text of [telegram(original), slack(original)]) {
        expect(text).toContain(escapedAnswer);
        expect(text).toContain(`Original &amp; &lt;creator&gt; — ${amount}`);
        expect(text).toContain(`/ ${paymentMode ?? "legacy"}`);
        expect(text).toContain("/dispatch/synthetic-run");
        expect(text).not.toContain("/claim-run#");
        expect(text).not.toMatch(/Arc (?:mainnet|testnet)/u);
      }
      expect(JSON.stringify(original)).toBe(before);
    });
  it.each(requests)("%s localizes zero/one/many source grammar and retains transport caps", (_, question) => {
    for (const count of [0, 1, 2]) {
      const original = run(question);
      original.citations = Array.from({ length: count }, () => original.citations[0]);
      original.answer = "unchanged evidence ".repeat(1000);
      const sourceLabel = botResearchMessages(question)(count === 1 ? "sourcesOne" : "sourcesOther", { count });
      const embed = discord(original).embeds[0];
      expect(embed.footer.text).toContain(sourceLabel);
      expect(embed.description.length).toBeLessThanOrEqual(3500);
      expect(embed.fields).toHaveLength(count ? 1 : 0);
      expect(telegram(original).length).toBeLessThanOrEqual(4096);
      expect(slack(original).length).toBeLessThanOrEqual(12000);
    }
  });
});
