import type { Conflict, GatheredContent, SynthesisFailureStage } from "../llm/reasoning-engine";
import { publicReadRecoveryLines, reportLabel, type PublicReadOutcome } from "./read-recovery";
import { synthesisFailureDetail } from "./synthesis-failure";

/** Only observed reading limits and an explicitly unverified conflict flag become next steps.
 * No draft assertions, new citation markers, evidence eligibility or payment authority. */
export function researchFollowUp(input: {
  vi: boolean;
  outcomes: PublicReadOutcome[];
  gathered: GatheredContent[];
  conflicts: Conflict[];
  paymentReviewRequired?: boolean;
  synthesisFailure?: SynthesisFailureStage;
}): string {
  const { vi } = input;
  const rows = publicReadRecoveryLines(input.outcomes, vi);
  const synthesis = synthesisFailureDetail(input.synthesisFailure, input.gathered.length, vi);
  if (synthesis) rows.unshift(`- ${synthesis}`);
  const limited = input.gathered.filter(source => source.webProvenance?.truncated ||
    source.publicDeliveryKind === "abstract" || source.scholarly?.evidenceScope === "abstract-page");
  for (const source of limited.slice(0, 8)) {
    const name = reportLabel(source.itemTitle ?? source.sourceName);
    if (source.webProvenance?.truncated) rows.push(vi
      ? `- “${name}”: bản trích xuất đã bị cắt. Đọc phần còn thiếu của đúng phiên bản trước khi kết luận về toàn bộ tài liệu; giữ bản đã lưu để đối chiếu.`
      : `- “${name}”: the extracted text was truncated. Read the missing section of the same version before making whole-document conclusions; retain this snapshot for comparison.`);
    if (source.publicDeliveryKind === "abstract" || source.scholarly?.evidenceScope === "abstract-page") rows.push(vi
      ? `- “${name}”: chỉ đọc được trang tóm tắt. Lấy toàn văn đúng phiên bản trước khi so sánh phương pháp, đánh giá hoặc các giới hạn chưa có trong tóm tắt.`
      : `- “${name}”: only the abstract page was read. Obtain the exact full-text version before comparing methods, evaluations or limitations absent from the abstract.`);
  }
  const known = new Set(input.gathered.map(source => source.marker));
  const reportedConflict = input.conflicts.some(conflict =>
    new Set(conflict.positions.filter(position => known.has(position.marker)).map(position => position.marker)).size >= 2);
  if (reportedConflict) rows.push(vi
    ? "- Model báo có khác biệt giữa các nguồn; nhận định này chưa được xác minh độc lập. Đối chiếu nguyên văn và phiên bản, rồi yêu cầu chủ tài liệu xác nhận quy định hoặc kết quả nào áp dụng. Không dùng lựa chọn ưu tiên của model để coi mâu thuẫn đã được giải quyết."
    : "- The model flagged differing source statements; that assessment is not independently verified. Compare the original passages and revisions, then ask the document owner which policy or result applies. The model's preferred source does not resolve a conflict.");
  if (input.paymentReviewRequired) rows.unshift(vi
    ? "- Trước bất kỳ lượt trả phí mới nào, kiểm tra biên nhận và bản ghi thanh toán gốc của lượt này; xử lý trạng thái đang chờ hoặc chưa rõ trước khi mua lại. Lỗi đọc và các bước tiếp tục không xóa khoản đã trả hay khoản còn giữ."
    : "- Before any new paid attempt, inspect this job's original payment receipts and records; resolve pending or unknown outcomes before buying again. Read failures and follow-up steps do not erase recorded charges or reservations.");
  if (!rows.length) return "";
  return [vi ? "### Việc cần làm để hoàn thiện kết quả" : "### Next steps to complete this research",
    vi ? "Các bước dưới đây là hướng dẫn tiếp tục; lượt này chưa tự thực hiện chúng. Chúng không thay đổi bằng chứng hoặc trạng thái thanh toán đã ghi."
      : "These are suggested follow-up steps; this run has not performed them. They do not change the recorded evidence or payment state.",
    ...rows].join("\n\n");
}
