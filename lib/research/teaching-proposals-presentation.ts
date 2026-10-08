import type { TeachingProposalDelivery } from "./teaching-proposals";

/** Literal proposal text cannot become Markdown structure or citation controls. */
function literal(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
    .replace(/\[\s*(S\d+)\s*\]/gu, "[\u200b$1]")
    .replace(/[\\`*_{}\[\]()<>#!|]/gu, "\\$&");
}

export function teachingProposalAnswer(delivery: TeachingProposalDelivery): string {
  const vi = delivery.request.language === "vi";
  const lines = [vi ? "### Đề xuất dạy học" : "### Teaching proposals", ""];
  if (delivery.proposals.length) lines.push(vi ? "Các hoạt động và tình huống dưới đây là đề xuất của Keryx, dựa trên kiến thức đã dẫn nguồn ở trên."
      : "The activities and invented scenarios below are Keryx proposals, based on the cited explanation above.", "");
  for (const { label, proposal } of delivery.proposals) {
    lines.push(`**${literal(label)}${proposal.kind === "activity" ? ` (${proposal.durationMinutes} ${vi ? "phút" : "minutes"})` : ""}**`,
      literal(proposal.text));
    for (const condition of proposal.conditions) lines.push(`${vi ? "Điều kiện" : "Condition"}: ${literal(condition)}`);
    if ("answer" in proposal) lines.push(`${vi ? "Đáp án" : "Answer"}: ${literal(proposal.answer)}`);
    lines.push("");
  }
  if (delivery.gaps.length) {
    if (!delivery.proposals.length) lines.push(vi ? "Chưa cung cấp được đề xuất đủ căn cứ và kiểm tra." : "No proposal passed the required premise and review checks.");
    for (const kind of ["activity", "classification-example", "exit-question"] as const) {
      if (!delivery.gaps.some(gap => gap.reason === "requested-count" && gap.kind === kind)) continue;
      const names = vi ? { activity: "hoạt động", "classification-example": "ví dụ phân loại", "exit-question": "câu hỏi cuối giờ" }
        : { activity: "activity", "classification-example": "classification examples", "exit-question": "exit question" };
      lines.push(vi ? `Còn thiếu ${names[kind]} đã yêu cầu; không bổ sung tình huống chưa đủ căn cứ.`
        : `The requested ${names[kind]} could not be delivered completely; unsupported proposals are withheld.`);
    }
    if (delivery.gaps.some(gap => gap.reason === "explanation-word-limit")) lines.push(vi
      ? "Phần giải thích đã dẫn nguồn vượt giới hạn từ yêu cầu; ràng buộc này chưa được đáp ứng."
      : "The cited explanation exceeds the requested word limit; that constraint remains unmet.");
  }
  return lines.join("\n").trim();
}
