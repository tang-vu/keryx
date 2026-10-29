import type { pdfReadingCopy } from "../en/pdf-reading";

/** Exact source-bound machine draft; no human approval, OCR or full-document claim. */
export const pdfReadingChinese = {
  summary: "PDF 文本提取已访问 {read} 页，共 {total} 页。",
  emptyPages: "未能从已访问的页面 {pages} 提取文本。这些页面可能是扫描页、空白页，或因其他原因无法由文本读取器读取。",
  limit: "页数或字符限制导致文本提取在文档读取完成前停止。对整份文档作出结论前，请直接阅读剩余原始页面；字符截断也可能使最后访问的页面未被完整读取。请保留此快照以供比较。",
  textOnly: "仅读取了 PDF 中可用的文本层；未解读图片和图表。",
  recovery: "请检查同一原始版本。如有需要，获取带文本层的 PDF、出版方文本或另行经过 OCR 处理的副本；本次运行未执行 OCR。",
} satisfies typeof pdfReadingCopy;
