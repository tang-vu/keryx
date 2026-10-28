import { pdfReadingCopy } from "../../locales/en/pdf-reading";
import { observedPdfTextScope } from "../web-research/pdf-text-scope";

/** Each observed clause retains its authoritative English counterpart for language tags. */
export function pdfReadingNoticeParts(value: unknown, vi = false, copy = pdfReadingCopy): { english: string; text: string }[] {
  const scope = observedPdfTextScope(value);
  if (!scope) return [];
  const { pagesRead, totalPages, pagesWithoutText, textLimitReached } = scope;
  const parts: { english: string; text: string }[] = [];
  const add = (key: keyof typeof pdfReadingCopy, vietnamese: string, values: Record<string, string | number> = {}) => {
    const format = (template: string) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template);
    parts.push({ english: format(pdfReadingCopy[key]), text: vi ? vietnamese : format(copy[key]) });
  };
  add("summary", `Đã thử trích xuất văn bản trên ${pagesRead}/${totalPages} trang PDF.`, { read: pagesRead, total: totalPages });
  if (pagesWithoutText.length) add("emptyPages",
    `Không trích xuất được chữ từ các trang đã thử đọc: ${pagesWithoutText.join(", ")}. Các trang này có thể là bản scan, trang trắng hoặc không cung cấp văn bản cho bộ đọc.`,
    { pages: pagesWithoutText.join(", ") });
  if (textLimitReached || pagesRead < totalPages) add("limit",
    "Giới hạn số trang hoặc ký tự đã dừng trích xuất trước khi hoàn tất tài liệu. Đọc trực tiếp các trang còn lại của bản gốc trước khi kết luận về toàn bộ tài liệu; giới hạn ký tự có thể cắt giữa trang cuối đã thử đọc. Giữ bản trích xuất này để đối chiếu.");
  add("textOnly", "Chỉ đọc lớp văn bản có sẵn trong PDF; chưa diễn giải ảnh hoặc hình minh họa.");
  if (pagesWithoutText.length) add("recovery",
    "Đối chiếu đúng phiên bản gốc. Nếu cần, lấy PDF có lớp văn bản, bản văn bản của nhà xuất bản hoặc bản đã được xử lý OCR riêng; lượt này chưa thực hiện OCR.");
  return parts;
}

/** Recorded extraction facts and conditional manual recovery, never a content verdict. */
export function pdfReadingNotice(value: unknown, vi = false, copy = pdfReadingCopy): string {
  return pdfReadingNoticeParts(value, vi, copy).map(part => part.text).join(" ");
}
