import type { SynthesisFailureStage } from "../llm/reasoning-engine";

/** Describe the observed application stage, never infer a supplier error's cause.
 * Reading is retained work, not proof of qualified evidence or a useful answer. */
export function synthesisFailureDetail(stage: SynthesisFailureStage | undefined, reads: number, vi: boolean): string {
  if (!Number.isSafeInteger(reads) || reads < 1) return "";
  let reason: string;
  switch (stage) {
    case "input": reason = vi
      ? "chưa chuẩn bị được các trích đoạn trong giới hạn để tổng hợp và kiểm tra"
      : "bounded excerpts could not be prepared for synthesis and review"; break;
    case "generation": reason = vi
      ? "bước tạo bản phân tích không khả dụng hoặc kết quả không qua kiểm tra định dạng"
      : "written synthesis was unavailable or its output could not be validated"; break;
    case "review": reason = vi
      ? "bước kiểm tra bản phân tích không khả dụng hoặc kết quả kiểm tra không hợp lệ"
      : "the synthesis review was unavailable or its result could not be validated"; break;
    case "synthesis": reason = vi
      ? "bước tổng hợp không hoàn tất; chưa xác định được bước con gây lỗi"
      : "synthesis did not complete; the failed internal stage is unknown"; break;
    default: return "";
  }
  return vi
    ? `Đã đọc ${reads} nguồn, nhưng ${reason}. Điều này không chứng minh rằng tài liệu thiếu bằng chứng. Giữ kết quả đọc và biên nhận của đơn gốc để kiểm tra trạng thái giao kết quả trước bất kỳ yêu cầu trả phí mới nào.`
    : `Read ${reads} source(s), but ${reason}. This does not establish that the documents lack evidence. Retain this job's original reads and receipts for delivery review before any new paid request.`;
}
