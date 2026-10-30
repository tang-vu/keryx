import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";

/** Machine draft; canonical financial and review authority remains English. */
export const botControlsJapanese = Object.freeze({
  ...botControlsEnglish,
  introduction: "質問すると、引用付きの回答を受け取れます。",
  usage: "使い方：",
  exampleQuestion: "x402 とは何ですか？",
  privateQuestion: "この個別チャットでは、質問をそのまま入力することもできます。",
  status: "状態：",
  financialDetails: "財務詳細（英語）：",
  languageCurrent: "回答の言語設定：{preference}。",
  languageHelp: "/language en|vi|pt|es|fr|zh-Hans|de|ja|ko|hi|id|ru|ar|auto で回答とヘルプの言語を設定します。元の質問で明示した回答言語が優先されます。auto は質問に従います。",
  languageInvalid: "対応する値：en、vi、pt（pt-BRも可）、es、fr、zh-Hans、de、ja、ko、hi、id、ru、ar、auto。",
  languageSaved: "回答とヘルプの言語設定を保存しました：{preference}。",
  languageUnavailable: "言語設定を読み取れなかったか、保存を確認できませんでした。保存できたとは表示しません。",
  languagePrivate: "Keryx との個別チャットで言語設定を変更または確認してください。",
  privatePreparing: "Keryx は非公開の研究返信を準備しています…",
} satisfies BotControlsCatalogue);
