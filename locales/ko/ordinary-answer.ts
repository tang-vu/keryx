import type { NativeAnswerCopy } from "../../lib/research/native-answer-copy";

/** Machine draft; no human review or language observation is implied. */
export const ordinaryAnswerKorean = Object.freeze({
  summaryIntro: "모델이 작성한 요약으로, 문장마다 인용이 있습니다. 각 문장은 검토에 사용한 출처의 원문 발췌와 함께 표시됩니다.",
  excerptIntro: "출처 발췌만 제공합니다. 초안을 결론으로 제시하지 않으며 종합 답변의 완전성은 확인되지 않았습니다. 조사 대상은 살펴볼 주제이며 입증된 결론이 아닙니다.",
  unavailableIntro: "근거가 뒷받침하는 답변이 없습니다. 종합 또는 근거 검토가 완료되지 않았습니다. 원래 읽기 결과와 수령 기록은 보존됩니다.",
  emptyIntro: "근거가 뒷받침하는 답변이 없습니다. 읽은 내용에서 조사 대상에 대해 채택 조건을 충족하는 발췌를 얻지 못했습니다.",
  target: "조사 대상",
  topic: "요청한 주제(미확인)",
  source: "출처 원문",
  unavailableGap: "이번 실행에서 이 조사 대상의 근거를 평가하지 못했습니다.",
  gap: "근거 부족: 이 조사 대상에 대해 채택 조건을 충족하는 발췌가 없습니다.",
  partialGap: "근거 부족: 기록된 평가가 이 조사 대상의 뒷받침 기준에 미치지 못합니다.",
  reviewNotice: "문장은 모델이 작성하고 검토했으며 독립적으로 검증되지 않았습니다.",
  limitations: "발췌는 출처와의 연결을 보여 주지만 출처의 정확성이나 종합 답변의 완전성을 입증하지 않습니다. 출처에는 오류나 상충하는 내용이 있을 수 있습니다. 결제 상태는 별도로 기록됩니다.",
  compactNotice: "모든 조사 대상과 채택된 발췌를 보존하면서 짧은 글머리표 {count}개로 제시할 수 없었습니다. 아래에 조사 대상별로 표시합니다.",
  compactNote: "모델이 작성하고 검토한 요약입니다. 함께 제시된 출처 발췌와 대조해 주세요. 종합 답변의 완전성과 출처의 정확성은 확인되지 않았습니다. 결제 상태는 별도로 기록됩니다.",
  confidence: Object.freeze({
    synthetic: "이번 실행에는 합성된 시연 자료가 포함되어 있어 사실에 대한 신뢰도를 뒷받침할 수 없습니다",
    "no-citation": "근거 채택 조건을 통과한 인용이 없습니다",
    "unresolved-conflict": "출처 간 불일치 {count}건이 해결되지 않았습니다. 포괄성 점수만으로 상충하는 근거를 해결할 수 없습니다",
    "no-coverage": "조사 대상의 근거 포괄성 평가가 없습니다",
    gaps: "조사 대상 {count}개가 근거 기준에 미치지 못합니다",
    incomplete: "최종 평가에서 요청한 모든 부분에 대해 근거가 있는 완전한 답변을 확립하지 못했습니다",
    "explained-conflict": "출처를 우선한 이유는 설명되어 있지만 상충하는 근거로 인해 신뢰도에 한계가 있습니다",
    "publisher-groups": "관찰된 동일 DOI 문헌을 통합한 뒤 출판사 도메인 그룹 {count}개가 모든 조사 대상에 대응하는 근거 구절을 제공합니다. 이 분류는 독립적인 교차 확인이나 사실의 정확성을 입증하지 않습니다",
    "limited-sources": "근거 검토를 거친 출처 {count}개가 모든 조사 대상을 포괄하지만 교차 확인이나 뒷받침 강도는 제한적입니다",
  }),
  delivery: Object.freeze({
    unavailable: "종합 또는 근거 검토가 완료되지 않았습니다. 출처의 뒷받침과 답변의 유용성은 아직 평가되지 않았습니다.",
    summary: "각 요약 문장은 원문 발췌와 연결되어 모델의 검토를 거쳤습니다. 완전성과 독립적인 사실 정확성은 확인되지 않았습니다.",
    excerpts: "출처 발췌만 제공합니다. 종합 답변의 완전성과 각 주장의 뒷받침 여부는 확인되지 않았습니다.",
  }),
  assessment: "근거 평가",
  lowConfidence: "낮은 신뢰도",
  provisional: "잠정적인 결과로 다뤄 주세요.",
  sentenceEnd: ".",
}) satisfies NativeAnswerCopy;
