import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";
/** Neutral machine draft; browser review boundary remains English. */
export const botControlsKorean = Object.freeze({
  ...botControlsEnglish,
  introduction: "질문을 입력하면 인용이 포함된 답변을 받을 수 있습니다.",
  usage: "사용법:",
  exampleQuestion: "x402는 무엇인가요?",
  privateQuestion: "이 비공개 채팅에서는 질문을 바로 입력해도 됩니다.",
  status: "상태:",
  financialDetails: "결제 세부 정보(영어):",
  languageCurrent: "선호 답변 언어: {preference}.",
  languageSaved: "답변 및 도움말 언어 설정을 저장했습니다: {preference}.",
  languageUnavailable: "언어 설정을 읽거나 저장 완료를 확인하지 못했습니다. 저장에 성공했다고 표시하지 않습니다.",
  languagePrivate: "Keryx와의 비공개 채팅에서 언어 설정을 지정하거나 확인해 주세요.",
  privatePreparing: "Keryx가 비공개 조사 답변을 준비하고 있습니다…",
} satisfies BotControlsCatalogue);
