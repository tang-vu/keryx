import type { ReportPresentationCatalogue } from "../en/report-presentation";

/** Machine-authored ordinary labels. Original topics and machine fields stay exact. */
export const reportPresentationChinese = Object.freeze({
  target: "{marker} 研究目标（未核实）：{claim}",
  coverage: "研究目标（未核实）：{claim}：已记录的覆盖率估计为 {coverage}；{sources}",
  noSources: "没有获准使用的来源",
  documentVersion: "文档版本：{version}",
  provenance: "观察到的来源信息：{provenance}",
  scope: "原始请求中的来源范围：{scope}",
  scholarly: "观察到的学术元数据和阅读范围（同行评审状态未知）：{metadata}",
} satisfies ReportPresentationCatalogue);
