import { pdfReadingCopy } from "../../locales/en/pdf-reading";
import { observedPdfTextScope } from "../web-research/pdf-text-scope";

/** Recorded extraction facts and conditional manual recovery, never a content verdict. */
export function pdfReadingNotice(value: unknown, vi = false, copy = pdfReadingCopy): string {
  const scope = observedPdfTextScope(value);
  if (!scope) return "";
  const { pagesRead, totalPages, pagesWithoutText, textLimitReached } = scope;
  const parts = [vi ? `Đã thử trích xuất văn bản trên ${pagesRead}/${totalPages} trang PDF.` :
    copy.summary.replace("{read}", String(pagesRead)).replace("{total}", String(totalPages))];
  if (pagesWithoutText.length) parts.push(vi
    ? `Không trích xuất được chữ từ các trang đã thử đọc: ${pagesWithoutText.join(", ")}. Các trang này có thể là bản scan, trang trắng hoặc không cung cấp văn bản cho bộ đọc.`
    : copy.emptyPages.replace("{pages}", pagesWithoutText.join(", ")));
  if (textLimitReached || pagesRead < totalPages) parts.push(vi
    ? "Giới hạn số trang hoặc ký tự đã dừng trích xuất trước khi hoàn tất tài liệu. Đọc trực tiếp các trang còn lại của bản gốc trước khi kết luận về toàn bộ tài liệu; giới hạn ký tự có thể cắt giữa trang cuối đã thử đọc. Giữ bản trích xuất này để đối chiếu." : copy.limit);
  parts.push(vi ? "Chỉ đọc lớp văn bản có sẵn trong PDF; chưa diễn giải ảnh hoặc hình minh họa." : copy.textOnly);
  if (pagesWithoutText.length) parts.push(vi
    ? "Đối chiếu đúng phiên bản gốc. Nếu cần, lấy PDF có lớp văn bản, bản văn bản của nhà xuất bản hoặc bản đã được xử lý OCR riêng; lượt này chưa thực hiện OCR."
    : copy.recovery);
  return parts.join(" ");
}
