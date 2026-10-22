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
    ? "Giới hạn số trang hoặc ký tự đã dừng trích xuất trước khi hoàn tất tài liệu." : copy.limit);
  parts.push(vi ? "Chưa đọc ảnh, hình minh họa hoặc chữ trong bản scan." : copy.textOnly);
  if (pagesWithoutText.length || textLimitReached || pagesRead < totalPages) parts.push(vi
    ? "Đối chiếu đúng phiên bản gốc. Nếu cần, lấy PDF có lớp văn bản, bản văn bản của nhà xuất bản hoặc bản đã được xử lý OCR riêng; lượt này chưa thực hiện OCR."
    : copy.recovery);
  return parts.join(" ");
}
