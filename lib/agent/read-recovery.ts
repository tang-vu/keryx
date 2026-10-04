/** Recorded read failures are operations metadata, never evidence about the document. */
export interface PublicReadOutcome { name: string; code: string }

export function reportLabel(value: string): string {
  return value.normalize("NFC").replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ").trim().slice(0, 160)
    .replace(/[\[\]<>`*_#|]/g, "");
}

function recovery(code: string, vi: boolean): string {
  switch (code) {
    case "pdf-extraction-unavailable": return vi
      ? "Không trích xuất được văn bản PDF. Kiểm tra PDF có văn bản có thể chọn hay chỉ là ảnh; lấy bản PDF có lớp văn bản hoặc bản văn bản từ nhà xuất bản, giữ đúng tài liệu và phiên bản. Lượt này chưa thực hiện OCR."
      : "PDF text extraction failed. Check whether the PDF contains selectable text or only images; obtain a text-layer PDF or publisher text for the same document and version. This run did not perform OCR.";
    case "html-extraction-unavailable": return vi
      ? "Không trích xuất được văn bản trang HTML. Tìm bản văn bản/PDF do cùng nhà xuất bản cung cấp, giữ đúng tài liệu và phiên bản; bản xem trước không thay thế nội dung gốc."
      : "HTML text extraction failed. Look for a publisher-provided text/PDF edition of the same document and version; a preview cannot replace the original content.";
    case "article-byte-limit": return vi
      ? "Tài liệu vượt giới hạn dung lượng đọc. Chọn phần tài liệu cụ thể hoặc bản văn bản/PDF gọn hơn từ cùng nhà xuất bản, giữ đúng phiên bản; chưa đọc được toàn bộ tài liệu."
      : "The document exceeded the read-size limit. Select a specific section or smaller publisher text/PDF edition of the same version; the whole document was not read.";
    case "document-identity-changed": return vi
      ? "Địa chỉ chuyển hướng không giữ đúng danh tính tài liệu yêu cầu. Cung cấp liên kết cho đúng phiên bản; không dùng phiên bản khác để lấp chỗ thiếu."
      : "The redirect did not preserve the requested document identity. Supply a link to the exact version; do not fill this gap with a different version.";
    case "empty-or-duplicate-body": return vi
      ? "Nội dung trống hoặc trùng với bản đã đọc nên không được thêm. Kiểm tra văn bản gốc và tìm nguồn độc lập nếu cần đối chiếu; URL khác không chứng minh có bằng chứng độc lập."
      : "An empty or duplicate body was not added. Inspect the original and seek an independent source if corroboration is needed; another URL does not establish independent evidence.";
    case "web-operation-limit": return vi
      ? "Đã chạm giới hạn số lượt hoặc thời gian đọc. Ưu tiên đúng tài liệu còn thiếu trong một lượt nghiên cứu riêng; cần xem lại chi phí và phạm vi trước khi chạy thêm."
      : "The read-attempt or time limit was reached. Prioritize the missing original in a separate research task after reviewing its scope and cost.";
    case "invalid-url": return vi
      ? "Địa chỉ tài liệu không hợp lệ. Cung cấp URL HTTPS công khai của đúng tài liệu gốc."
      : "The document URL was invalid. Supply a public HTTPS URL for the exact original.";
    case "cancelled": return vi
      ? "Lượt đọc đã bị hủy hoặc hết thời gian cho phép. Giữ kết quả đã có và xem lại phạm vi trước khi yêu cầu một lượt mới."
      : "The read was cancelled or its allowed time elapsed. Keep the existing result and review scope before requesting a new run.";
    default: return vi
      ? "Chưa lấy được văn bản gốc. Kiểm tra khả năng truy cập URL của nhà xuất bản và cung cấp bản gốc có thể đọc của cùng tài liệu; lỗi này không chứng minh tài liệu không tồn tại."
      : "Original text was unavailable. Check the publisher URL and provide an accessible original of the same document; this failure does not establish that the document does not exist.";
  }
}

/** Bounded, deterministic suggestions only. Calling this helper starts no read or purchase. */
export function publicReadRecoveryLines(outcomes: PublicReadOutcome[], vi: boolean): string[] {
  const unique = new Map<string, PublicReadOutcome>();
  for (const outcome of outcomes) {
    const name = reportLabel(outcome.name) || (vi ? "Nguồn công khai" : "Public source");
    const key = `${name}\0${outcome.code}`;
    if (!unique.has(key)) unique.set(key, { name, code: outcome.code });
  }
  const entries = [...unique.values()];
  const rows = entries.slice(0, 8).map(outcome => `- “${outcome.name}”: ${recovery(outcome.code, vi)}`);
  if (entries.length > 8) rows.push(vi
    ? `- Còn ${entries.length - 8} lỗi đọc khác trong nhật ký lượt này.`
    : `- ${entries.length - 8} additional read failures are recorded in this run's trace.`);
  return rows;
}
