import { type ReportPresentationCatalogue } from "../en/report-presentation";

/** Machine draft; canonical financial and review authority remains English. */
export const reportPresentationJapanese = Object.freeze({
  target: "{marker} 研究対象（未検証）：{claim}",
  coverage: "研究対象（未検証）：{claim}：記録された網羅性の推定値 {coverage}、{sources}",
  noSources: "採用条件を満たした資料はありません",
  documentVersion: "文書の版：{version}",
  provenance: "確認された出典情報：{provenance}",
  scope: "元の依頼に含まれる資料の範囲：{scope}",
  scholarly: "確認された学術メタデータと読取範囲（査読状況は不明）：{metadata}",
} satisfies ReportPresentationCatalogue);
