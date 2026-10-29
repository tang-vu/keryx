import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";

/** Ordinary controls, separate from answer observation and financial/claim authority. */
export const botControlsChinese = Object.freeze({
  introduction: "提出问题，即可获得附有引用的答案。",
  usage: "用法：",
  exampleQuestion: "x402 是什么？",
  reviewBoundary: botControlsEnglish.reviewBoundary,
  privateQuestion: "在此私聊中，也可以直接输入问题。",
  status: "状态：",
  financialDetails: "财务详情（英文）：",
  languageHelp: "使用 /language en|vi|pt|es|fr|zh-Hans|de|ja|ko|hi|id|ru|auto 设置答案和帮助语言。原始问题中明确指定的输出语言优先；auto 使用现有的自动语言选择规则。",
  languageCurrent: "答案语言偏好：{preference}。",
  languageSaved: "已保存答案和帮助语言偏好：{preference}。",
  languageUnavailable: "无法读取语言偏好或确认保存成功；并未声称保存成功。",
  languageInvalid: "支持的值：en、vi、pt（也接受 pt-BR）、es、fr、zh-Hans、de、ja、ko、hi、id、auto。",
  languagePrivate: "请在与 Keryx 的私聊中设置或查看语言偏好。",
  privatePreparing: "Keryx 正在准备你的私人研究回复…",
} satisfies BotControlsCatalogue);
