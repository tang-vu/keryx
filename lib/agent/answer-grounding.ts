import type { EvidenceLedger } from "./evidence-ledger";
import { MIN_REWARD_SUPPORT, extractAnswerMarkers, removeUnsupportedCitationMarkers } from "./evidence-ledger";
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

/**
 * Opt-in delivery (KERYX_ANSWER_DELIVERY=cited-synthesis): the model-written answer with every
 * rejected citation marker removed, followed by the unchanged excerpt ledger so each surviving
 * citation can be checked against its quote. Sentences that end up with no marker are prose the
 * gate could not tie to a source, and the note says so. Falls back to excerpt-only delivery when no
 * cited sentence survives. Reward gating is decided by the ledger and is identical in both modes.
 */
export function finalizeCitedSynthesis(input: {
  question: string;
  answer: string;
  ledger: EvidenceLedger;
}): string {
  const excerpts = finalizeGroundedAnswer(input);
  const draft = removeUnsupportedCitationMarkers(input.answer, input.ledger.acceptedMarkers).trim();
  if (!input.ledger.acceptedMarkers.size || !extractAnswerMarkers(draft).size) return excerpts;
  const vi = researchResponseLanguage(input.question) === "vi";
  const note = vi
    ? "Tóm tắt do mô hình viết. Chỉ giữ các trích dẫn có trích đoạn khớp nguồn; câu không có trích dẫn là chưa được kiểm chứng. Đối chiếu với các trích đoạn bên dưới."
    : "Model-written summary. Only citations backed by a source-matched excerpt are kept; a sentence without a citation is unverified. Check it against the excerpts below.";
  // Drop the excerpt-only introduction and closing note: both state that the draft was withheld.
  const ledgerSections = excerpts.split("\n\n").slice(1, -1).join("\n\n");
  return [draft, note, ledgerSections].join("\n\n");
}
