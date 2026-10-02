import type { EvidenceLedger } from "./evidence-ledger";
import { extractAnswerMarkers } from "./evidence-ledger";
import { researchResponseLanguage } from "./empty-public-evidence";

function literal(value: string): string {
  // The reading UI's small renderer does not decode Markdown escapes/entities. Invisible
  // separators keep source brackets from becoming citation controls; receipt quotes stay exact.
  return value.replace(/\[(S\d+)\]/g, "[\u200b$1]").replace(/[`*_]/g, "$&\u200b")
    .replace(/[\r\n]+/g, " ");
}

/**
 * A rejected footnote cannot leave its assertions behind as uncited fact. When any proposed
 * support fails, conservatively replace the whole draft with inspectable qualified excerpts.
 * No model rewrite, support promotion, metadata enrichment or payment authorization occurs.
 */
export function finalizeGroundedAnswer(input: {
  question: string;
  answer: string;
  ledger: EvidenceLedger;
}): string {
  const { ledger } = input;
  const qualifies = (item: EvidenceLedger["evidence"][number]) => item.qualifiesForAnswer ?? item.qualifiesForReward;
  const requiresFallback = ledger.acceptedMarkers.size === 0 || ledger.droppedCitations.length > 0 ||
    ledger.droppedEvidence > 0 || ledger.evidence.some(item => !qualifies(item)) ||
    [...extractAnswerMarkers(input.answer)].some(marker => !ledger.acceptedMarkers.has(marker));
  if (!requiresFallback) return input.answer;

  const vi = researchResponseLanguage(input.question) === "vi";
  const qualifying = ledger.evidence.filter(item => qualifies(item) && ledger.acceptedMarkers.has(item.marker));
  const intro = qualifying.length
    ? vi ? "Bản nháp có nhận định chưa vượt qua kiểm tra bằng chứng. Dưới đây chỉ giữ các trích đoạn đủ điều kiện; chưa phải một câu trả lời đầy đủ."
      : "Some draft assertions did not pass the evidence checks. Only qualifying excerpts are retained below; this is an incomplete answer."
    : vi ? "Chưa có câu trả lời được bằng chứng hỗ trợ. Nội dung đã đọc chưa cung cấp trích đoạn đủ điều kiện cho các yêu cầu nghiên cứu; bản nháp không được giữ như kết luận."
      : "No supported answer. The read content supplied no qualifying excerpts for the research targets; the draft is withheld as a conclusion.";
  const sections = ledger.claimCoverage.map(claim => {
    const quotes = qualifying.filter(item => item.claimIndex === claim.claimIndex);
    const rows = quotes.map(item => `- “${literal(item.quote)}” [${item.marker}]`);
    const gap = vi
      ? "Thiếu bằng chứng: chưa có trích đoạn đủ điều kiện cho yêu cầu này."
      : "Evidence gap: no qualifying excerpt for this research target.";
    return `### ${literal(claim.claim)}\n\n${rows.length ? rows.join("\n") : gap}`;
  });
  const limitations = vi
    ? "Trích đoạn chỉ xác lập mức bám nguồn, không chứng minh tính đúng đắn hoặc toàn bộ nội dung bài. Các kết luận thiếu hỗ trợ trong bản nháp không được đưa vào câu trả lời; đọc thêm văn bản gốc để hoàn thiện câu trả lời. Trạng thái thanh toán vẫn nằm trong biên nhận riêng."
    : "Excerpts establish source grounding, not factual truth or whole-paper coverage. Unsupported draft conclusions are withheld; read more original text to complete the answer. Payment states remain in the separate receipt.";
  return [intro, ...sections, limitations].join("\n\n");
}
