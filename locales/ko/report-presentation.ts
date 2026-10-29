import type { ReportPresentationCatalogue } from "../en/report-presentation";
export const reportPresentationKorean = Object.freeze({
  target: "{marker} · 조사 대상(미확인): {claim}",
  coverage: "조사 대상(미확인): {claim}: 기록된 포괄성 추정치 {coverage}; {sources}",
  noSources: "채택된 출처 없음",
  documentVersion: "문서 버전: {version}",
  provenance: "관찰된 출처 정보: {provenance}",
  scope: "제공된 원본 출처 범위: {scope}",
  scholarly: "관찰된 학술 메타데이터와 읽기 범위(동료 심사 여부 알 수 없음): {metadata}",
} satisfies ReportPresentationCatalogue);
