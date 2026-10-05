import type { Decision } from "../types";
import { publicReadRecoveryLines, type PublicReadOutcome } from "./read-recovery";
import { requestedSourceUrls } from "../research/source-requirements";

export interface PublicDiscoverySummary {
  attemptedQueries?: number;
  succeededQueries?: number;
  failedQueries?: number;
  status?: "completed" | "unavailable" | "not-configured" | "withheld";
}

/** Explicit output requests take precedence; otherwise recognize Vietnamese question text. */
export function researchResponseLanguage(question: string): "en" | "vi" {
  const normalized = question.normalize("NFC").toLowerCase();
  const requested = [...normalized.matchAll(/(?:answer|respond|reply|write)\s+(?:only\s+)?(?:in|using)\s+(english|vietnamese)|(?:trả lời|viết|đáp)\s+(?:bằng\s+)?tiếng\s+(anh|việt)/gu)].at(-1);
  if (requested) return requested[1] === "vietnamese" || requested[2] === "việt" ? "vi" : "en";
  const accentedWords = normalized.split(/\s+/u).filter(word => /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/u.test(word));
  const vietnameseCue = /(?:^|\s)(?:tôi|của|và|cho|cần|hãy|không|bằng|so sánh|nghiên cứu)(?:\s|[.,!?]|$)/u.test(normalized);
  return accentedWords.length >= 3 && vietnameseCue ? "vi" : "en";
}

interface EmptyPublicOptions { question?: string; discovery?: PublicDiscoverySummary }

function recordedText(value: string, limit: number): string {
  return value.replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, limit);
}

function discoveryDetail(summary: PublicDiscoverySummary | undefined, vi: boolean): string {
  if (!summary) return "";
  if (summary.status === "withheld") return vi
    ? "Tìm kiếm web bên ngoài bị tắt theo phạm vi của lượt nghiên cứu này. "
    : "External web search was withheld for this run's scope. ";
  if (summary.status === "not-configured") return vi
    ? "Lượt nghiên cứu này chưa được cấu hình tìm kiếm web. "
    : "Broad web search was not configured for this run. ";
  if (summary.status === "unavailable") return vi
    ? "Dịch vụ tìm kiếm web không khả dụng trong lượt này; không thể kết luận rằng không có nguồn phù hợp. "
    : "Web search was unavailable in this run; this cannot establish that no relevant sources exist. ";
  const counts = [summary.attemptedQueries, summary.succeededQueries, summary.failedQueries];
  if (!counts.every(count => Number.isInteger(count) && count! >= 0)) return "";
  return vi
    ? `Tìm kiếm web: đã thử ${summary.attemptedQueries} truy vấn, ${summary.succeededQueries} thành công, ${summary.failedQueries} không khả dụng. `
    : `Web search: ${summary.attemptedQueries} queries attempted, ${summary.succeededQueries} succeeded, ${summary.failedQueries} unavailable. `;
}

/** Recorded codes/decisions only; never promote discovery metadata into read evidence. */
export function emptyPublicEvidenceDetail(
  outcomes: PublicReadOutcome[],
  skipped: Decision[],
  options: EmptyPublicOptions = {},
): string {
  const question = options.question ?? "";
  const vi = researchResponseLanguage(question) === "vi";
  const scholarly = /arxiv|\bdoi\b|10\.\d{4,9}\//iu.test(question);
  const failures = outcomes.slice(0, 3).map(outcome => `${recordedText(outcome.name, 120)} (${recordedText(outcome.code, 80)})`).join("; ");
  const gates = skipped.slice(0, 3).map(decision => `${recordedText(decision.sourceName, 120)}: ${recordedText(decision.rationale, 350)}`).join("; ");
  const detail = outcomes.length
    ? vi ? `Nguồn công khai đã chọn không cung cấp được văn bản có thể dùng: ${failures}. `
      : `Selected public originals could not supply usable text: ${failures}. `
    : vi ? `Chưa đọc thành công tài liệu công khai gốc nào. ${gates ? `Lý do SKIP đã ghi: ${gates}. ` : ""}`
      : `No original public document was successfully read. ${gates ? `Recorded SKIP reasons: ${gates}. ` : ""}`;
  // The URL parser is dependency-free and bounded; candidate hashing stays server-side.
  const recovery = requestedSourceUrls(question).urls.length
    ? vi ? "URL nguồn đã được cung cấp trong câu hỏi. Kiểm tra trạng thái URL, lý do từ chối khám phá, SKIP hoặc lỗi đọc nếu có trong nhật ký trước khi thu hẹp một lượt mới. "
      : "Source URLs were already supplied in the question. Inspect any recorded supplied-URL status and recorded discovery refusal, SKIP or read failure before narrowing a new task. "
    : scholarly
    ? vi ? "Thử một DOI chính xác hoặc mã arXiv có phiên bản và kiểm tra lý do SKIP/lỗi đọc đã ghi. "
      : "Try one exact DOI or versioned arXiv target and inspect the recorded SKIP/read failures. "
    : vi ? "Thu hẹp câu hỏi vào một quyết định cụ thể, thêm URL tài liệu gốc phù hợp và kiểm tra lý do SKIP/lỗi đọc đã ghi. "
      : "Narrow the question to one concrete decision, supply a relevant original source URL, and inspect the recorded SKIP/read failures. ";
  return discoveryDetail(options.discovery, vi) + detail + recovery + (vi
    ? "Tăng ngân sách nguồn không giải quyết được giới hạn chọn nguồn miễn phí hoặc trích xuất văn bản. Bản xem trước không phải bằng chứng đã đọc. Lượt này không chứng minh rằng không có bằng chứng phù hợp."
    : "A larger source budget does not resolve a free-source attention gate or extraction limit. Metadata previews are not read evidence. This does not establish that no relevant evidence exists.");
}

/** Payment states are supplied by the orchestrator; this presentation helper changes no ledger. */
export function emptyEvidenceAnswer(input: {
  question: string;
  outcomes: PublicReadOutcome[];
  skipped: Decision[];
  discovery?: PublicDiscoverySummary;
  fundingUnavailable: boolean;
  pendingPayments: number;
  settledPayments: number;
  fetchFailures: number;
}): string {
  const vi = researchResponseLanguage(input.question) === "vi";
  const prefix = vi ? "Chưa có câu trả lời được bằng chứng hỗ trợ: " : "No supported answer: ";
  if (input.fundingUnavailable) return prefix + (vi
    ? "nguồn trả phí bị giữ lại vì chưa xác minh được trạng thái sẵn sàng của nguồn tiền, và chưa thu được bằng chứng công khai có thể dùng. Tác động của việc nạp ví vẫn chưa rõ; kiểm tra bản ghi nạp tiền gốc trước khi thử trả phí lại."
    : "paid sources were withheld because funding readiness could not be verified, and no usable public evidence was gathered. Wallet funding effects remain unknown; inspect the original funding records before another paid attempt.");
  if (input.pendingPayments > 0) return prefix + (vi
    ? "xác nhận thanh toán nguồn còn đang chờ và chưa nhận được nội dung có thể dùng. Số tiền đang chờ vẫn được giữ; khoản đã xác nhận được ghi riêng. Giữ lượt này để đối soát trước khi mua lại."
    : "source payment confirmation remains pending and no usable content was received. Pending amounts stay reserved; any confirmed source payments remain recorded separately. Keep this job for reconciliation before buying again.");
  if (input.settledPayments > 0) return prefix + (vi
    ? "thanh toán nguồn đã hoàn tất nhưng chưa nhận được nội dung có thể dùng. Các khoản đã xác nhận vẫn được ghi nhận. Giữ lượt này để kiểm tra trước khi mua lại."
    : "source payments settled, but no usable content was received. Confirmed payments remain recorded. Keep this job for review before buying again.");
  const nextSteps = publicReadRecoveryLines(input.outcomes, vi);
  const detail = emptyPublicEvidenceDetail(input.outcomes, input.skipped, input)
    + (nextSteps.length ? `\n\n${nextSteps.join("\n")}` : "");
  if (input.fetchFailures > 0) return prefix + (vi
    ? "đọc nguồn thất bại và chưa có thanh toán nguồn nào được xác nhận. Kiểm tra bản ghi thanh toán của lượt này trước khi bắt đầu lượt trả phí khác. "
    : "source reads failed and no source payment was confirmed. Review this job's payment records before starting another paid job. ") + detail;
  return prefix + (vi
    ? "chưa có nguồn nào vượt qua kiểm tra mức liên quan và bằng chứng trong giới hạn lượt này. "
    : "no source passed the relevance and evidence checks within this run's limits. ") + detail;
}
