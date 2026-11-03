import type { PresentationLanguage } from "../../shared/i18n/presentation-language";
import type { WorkProductDelivery } from "./work-products";

const copy = {
  en: ["Proposed work product", "Draft proposals based on the factual premises below. This is a bounded model review, not a guarantee of completeness or results.", "Requested output", "Conditions", "Factual premises", "Some requested parts remain unverified. Check the missing premises, rejected proposals and original criteria before using this draft.", "The proposed draft was withheld; the existing answer and its recorded limits remain above."],
  vi: ["Bản nháp được đề xuất", "Các đề xuất dựa trên dữ kiện bên dưới. Đây là kiểm tra có giới hạn bằng model, chưa bảo đảm đầy đủ hoặc đạt kết quả.", "Đầu ra được yêu cầu", "Điều kiện", "Dữ kiện làm căn cứ", "Một số phần được yêu cầu chưa được xác minh. Kiểm tra dữ kiện còn thiếu, đề xuất bị từ chối và tiêu chí gốc trước khi dùng bản nháp.", "Chưa cung cấp được bản nháp đề xuất; câu trả lời và giới hạn đã ghi vẫn nằm ở trên."],
  zh: ["建议草案", "以下建议以所列事实为依据。模型审查范围有限，不保证完整性或实际效果。", "请求的成果", "适用条件", "事实依据", "部分要求尚未核实。使用草案前，请检查缺失依据、被拒绝的建议和原始要求。", "建议草案未获准提供；上方仍保留原有回答及其限制。"],
} as const;
function literal(value: string) {
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
    .replace(/\[\s*(S\d+)\s*\]/gu, "[\u200b$1]")
    .replace(/[\\`*_{}\[\]()<>#!|]/gu, "\\$&");
}

/** Only call after canonical attribution and settlement. Existing statement/
 * marker identities are repeated for inspection; they gain no new reward weight. */
export function workProductAnswer(delivery: WorkProductDelivery, language: PresentationLanguage): string {
  const c = language === "vi" ? copy.vi : language === "zh-Hans" ? copy.zh : copy.en;
  const header = `### ${c[0]}`;
  if (!delivery.sections.length) return `${header}\n\n${c[6]}`;
  const premises = [...new Map(delivery.sections.flatMap(row => row.premises).map(row => [row.id, row])).values()];
  const rows = delivery.sections.map(({ section, premises }) => {
    const markers = [...new Set(premises.map(row => row.statement.marker))].map(marker => `[${marker}]`).join(" ");
    return [`### ${literal(section.heading)}`, `${literal(section.text)} ${markers}`,
      ...(section.conditions.length ? [`${c[3]}: ${section.conditions.map(literal).join("; ")}`] : [])].join("\n\n");
  });
  const answer = [header, c[1], `${c[2]}: ${literal(delivery.request.deliverable)}`, ...rows,
    `### ${language === "vi" ? "Tiêu chí để người dùng đối chiếu" : language === "zh-Hans" ? "供使用者核对的要求" : "Caller review checklist"}`,
    ...delivery.request.criteria.map(criterion => `- ${literal(criterion)}`),
    `### ${c[4]}`, ...premises.map(({ statement }) =>
      `- ${literal(statement.text)} — “${literal(statement.quote)}” [${statement.marker}]`),
    ...(!delivery.criteriaReviewed ? [c[5]] : [])].join("\n\n");
  // No clipping of factual qualifications or arbitrary selected subset.
  return answer.length <= 12_000 ? answer : `${header}\n\n${c[6]}`;
}
