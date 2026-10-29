import { describe, expect, it } from "vitest";
import { chineseAnswerInstructions } from "./chinese-answer-intent";

const last = (question: string) => chineseAnswerInstructions(question.normalize("NFC").toLowerCase())
  .filter(instruction => instruction.eligible).at(-1)?.language;

describe("additional ordinary Chinese intent grammar", () => {
  it.each([
    "请用简体中文回答。解释这项规则。", "用简体中文回答。解释这项规则。", "请用中文回答。解释这项规则。",
    "用中文回答。解释这项规则。", "以中文回答。解释这项规则。", "使用中文回答。解释这项规则。",
    "Answer in Simplified Chinese. Explain the rule.", "Answer in Chinese. Explain the rule.",
    "Please answer in Chinese. Explain the rule.", "Answer in French. 请用简体中文回答。解释这项规则。",
    "No thanks\nAnswer in Chinese. Explain the rule.",
  ])("recognizes a bounded positive directive: %s", question => { expect(last(question)).toBe("zh-Hans"); });

  it.each([
    "不要用简体中文回答。Explain the rule.", "请不要用简体中文回答。Explain the rule.",
    "别用中文回答。Explain the rule.", "请别用中文回答。Explain the rule.", "不用中文回答。Explain the rule.",
    "不必用中文回答。Explain the rule.", "无需用中文回答。Explain the rule.", "勿用中文回答。Explain the rule.",
    "Do not answer in Chinese. Explain the rule.", "Don't\nanswer in Chinese. Explain the rule.",
    "Explain the phrase “请用中文回答”.", "解释「请用中文回答」这句话。", "解释『请用中文回答』这句话。",
    "解释《请用中文回答》这个标题。", "Explain `Answer in Chinese` as an instruction.",
    "请解释日本语中的汉字。", "日本語の漢字について説明してください。", "A title says Answer in Chinese.",
  ])("does not treat negation, a quoted original or Han characters as intent: %s", question => {
    expect(last(question)).toBeUndefined();
  });

  it("records unsupported Traditional Chinese so it can clear an earlier ordinary instruction", () => {
    for (const question of ["请用繁体中文回答。解释这项规则。", "請用繁體中文回答。", "Answer in Traditional Chinese."]) {
      const instruction = chineseAnswerInstructions(question.toLowerCase()).filter(row => row.eligible).at(-1);
      expect(instruction).toBeDefined(); expect(instruction?.language).toBeUndefined();
    }
  });
  it("keeps the original span and precedence for native English or a later Chinese instruction", () => {
    const question = "请用中文回答。请用英语回答。解释这项规则。";
    expect(last(question)).toBe("en");
    expect(last("请用英语回答。请用中文回答。解释这项规则。")).toBe("zh-Hans");
    for (const instruction of chineseAnswerInstructions(question))
      expect(question.slice(instruction.index, instruction.end)).toMatch(/用(?:中文|英语)回答/u);
    expect(question).toBe("请用中文回答。请用英语回答。解释这项规则。");
  });
  it("keeps quoted and negated English spans available to exclude old partial matches", () => {
    for (const question of ["“Answer in Simplified Chinese.”", "Do not answer in Chinese."]) {
      const instructions = chineseAnswerInstructions(question.toLowerCase());
      expect(instructions).toHaveLength(1); expect(instructions[0].eligible).toBe(false);
      expect(question.slice(instructions[0].index, instructions[0].end)).toMatch(/(?:answer|Answer) in (?:Simplified )?Chinese/u);
    }
  });
});
