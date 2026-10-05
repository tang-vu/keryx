import type { EvidenceLedger } from "./evidence-ledger";
import { MIN_REWARD_SUPPORT } from "./evidence-ledger";
import { researchResponseLanguage } from "./empty-public-evidence";

function literal(value: string): string {
  // The reading UI's small renderer does not decode Markdown escapes/entities. Invisible
  // separators keep source brackets from becoming citation controls; receipt quotes stay exact.
  return value.replace(/\[(S\d+)\]/g, "[\u200b$1]").replace(/[`*_]/g, "$&\u200b")
    .replace(/[\r\n]+/g, " ");
}

/**
 * Source-marker admission and target coverage do not verify every assertion in a draft.
 * The current proposal contract has no complete assertion-to-evidence mapping, so always
 * deliver inspectable qualified excerpts. In particular, an omitted proposal cannot bypass
 * this boundary, even when every requested target has evidence and no proposal was rejected.
 * No model rewrite, support promotion, metadata enrichment or payment authorization occurs.
 */
export function finalizeGroundedAnswer(input: {
  question: string;
  answer: string;
  ledger: EvidenceLedger;
}): string {
  const { ledger } = input;
  const qualifies = (item: EvidenceLedger["evidence"][number]) => item.qualifiesForAnswer ?? item.qualifiesForReward;
  const vi = researchResponseLanguage(input.question) === "vi";
  const qualifying = ledger.evidence.filter(item => qualifies(item) && ledger.acceptedMarkers.has(item.marker));
  const intro = qualifying.length
    ? vi ? "Bản nháp không được giữ như kết luận. Dưới đây chỉ giữ các trích đoạn nguồn đủ điều kiện; chưa xác minh được câu trả lời tổng hợp đầy đủ. Các chủ đề nghiên cứu không phải kết luận đã được chứng minh."
      : "Source excerpts only. The draft is withheld as a conclusion; complete synthesis is unverified. Qualifying source excerpts are quoted below. Research targets are topics to investigate, not established conclusions."
    : vi ? "Chưa có câu trả lời được bằng chứng hỗ trợ. Nội dung đã đọc chưa cung cấp trích đoạn đủ điều kiện cho các yêu cầu nghiên cứu; bản nháp không được giữ như kết luận."
      : "No supported answer. The read content supplied no qualifying excerpts for the research targets; the draft is withheld as a conclusion.";
  const sections = ledger.claimCoverage.map(claim => {
    const quotes = qualifying.filter(item => item.claimIndex === claim.claimIndex);
    const rows = quotes.map(item => `- “${literal(item.quote)}” [${item.marker}]`);
    const gap = vi
      ? "Thiếu bằng chứng: chưa có trích đoạn đủ điều kiện cho yêu cầu này."
      : "Evidence gap: no qualifying excerpt for this research target.";
    const target = vi ? "Yêu cầu nghiên cứu" : "Research target";
    const topic = vi ? "Chủ đề yêu cầu (chưa xác minh)" : "Requested topic (unverified)";
    const partialGap = vi ? "Thiếu bằng chứng: đánh giá ghi nhận vẫn dưới ngưỡng hỗ trợ cho yêu cầu này."
      : "Evidence gap: the recorded assessment remains below the support threshold for this target.";
    return [`### ${target} ${claim.claimIndex + 1}`, `${topic}: “${literal(claim.claim)}”`,
      rows.length ? rows.join("\n") : gap,
      ...(rows.length && !(claim.coverage >= MIN_REWARD_SUPPORT) ? [partialGap] : []),
    ].join("\n\n");
  });
  const limitations = vi
    ? "Trích đoạn chỉ xác lập mức bám nguồn, không chứng minh tính đúng đắn, quan hệ suy ra hay toàn bộ nội dung bài. Mức hỗ trợ và độ bao phủ là ước lượng, không chứng nhận câu trả lời đầy đủ. Nội dung nguồn có thể sai hoặc mâu thuẫn. Các kết luận trong bản nháp không được giữ; cần đối chiếu văn bản gốc và đánh giá thêm. Trạng thái thanh toán vẫn nằm trong biên nhận riêng."
    : "Excerpts establish source grounding, not factual truth, entailment or whole-paper coverage. Support and coverage are estimates, not certification of a complete answer. Source statements may be wrong or conflicting. Draft conclusions are withheld; inspect the original text and obtain further review. Payment states remain in the separate receipt.";
  return [intro, ...sections, limitations].join("\n\n");
}
