import type { pdfReadingCopy } from "../en/pdf-reading";

/** Exact source-bound machine draft; no human approval, OCR or full-document claim. */
export const pdfReadingKorean = Object.freeze({
  summary: "PDF 텍스트 추출 과정에서 전체 {total}페이지 중 {read}페이지에 접근했습니다.",
  emptyPages: "접근한 페이지 {pages}에서 텍스트가 추출되지 않았습니다. 스캔된 페이지이거나 빈 페이지일 수 있으며, 다른 이유로 텍스트 읽기 도구가 접근할 수 없는 페이지일 수도 있습니다.",
  limit: "페이지 수나 글자 수 한도로 인해 문서 전체를 처리하기 전에 텍스트 추출이 중단되었습니다. 문서 전체에 관한 결론을 내리기 전에 나머지 원본 페이지를 직접 읽으세요. 글자 수 한도로 중단되면 마지막으로 접근한 페이지도 일부만 처리되었을 수 있습니다. 비교를 위해 이 스냅샷을 보관하세요.",
  textOnly: "PDF에서 이용 가능한 텍스트 레이어만 읽었으며, 이미지와 도표는 해석하지 않았습니다.",
  recovery: "동일한 원본 버전을 확인하세요. 필요하다면 텍스트 레이어가 있는 PDF, 게시자가 제공하는 텍스트 또는 별도로 OCR 처리한 사본을 구하세요. 이번 실행에서는 OCR을 수행하지 않았습니다.",
} satisfies typeof pdfReadingCopy);
