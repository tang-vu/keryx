import type { EvidenceLedger } from "./evidence-ledger";
import { MIN_REWARD_SUPPORT } from "./evidence-ledger";
import { researchResponseLanguage } from "./empty-public-evidence";
import type { CitedStatement } from "./cited-statements";

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
 *
 * Reviewed cited statements are the one exception to excerpt-only delivery: each is a single
 * model-written sentence shown directly above the verbatim excerpt it was checked against, so
 * a reader can compare the two. A statement whose excerpt is not in this ledger is ignored.
 */
export function finalizeGroundedAnswer(input: {
  question: string;
  answer: string;
  ledger: EvidenceLedger;
  statements?: CitedStatement[];
  synthesisUnavailable?: boolean;
}): string {
  const { ledger } = input;
  const qualifies = (item: EvidenceLedger["evidence"][number]) => item.qualifiesForAnswer ?? item.qualifiesForReward;
  const vi = researchResponseLanguage(input.question) === "vi";
  const qualifying = ledger.evidence.filter(item => qualifies(item) && ledger.acceptedMarkers.has(item.marker));
  const summary = (input.statements ?? []).filter(statement => qualifying.some(item =>
    item.claimIndex === statement.claimIndex && item.marker === statement.marker && item.quote === statement.quote));
  if (summary.length) return citedSummary({ vi, ledger, qualifying, summary });
  const intro = qualifying.length
    ? vi ? "Bản nháp không được giữ như kết luận. Dưới đây chỉ giữ các trích đoạn nguồn đủ điều kiện; chưa xác minh được câu trả lời tổng hợp đầy đủ. Các chủ đề nghiên cứu không phải kết luận đã được chứng minh."
      : "Source excerpts only. The draft is withheld as a conclusion; complete synthesis is unverified. Qualifying source excerpts are quoted below. Research targets are topics to investigate, not established conclusions."
    : input.synthesisUnavailable ? vi
      ? "Chưa có câu trả lời được bằng chứng hỗ trợ. Bước tổng hợp hoặc kiểm tra bằng chứng chưa hoàn tất; chưa thể đánh giá bằng chứng cho các yêu cầu nghiên cứu. Kết quả đọc và biên nhận gốc vẫn được giữ."
      : "No supported answer. Synthesis or evidence review did not complete; evidence for the research targets could not be assessed. Original reads and receipts are retained."
    : vi ? "Chưa có câu trả lời được bằng chứng hỗ trợ. Nội dung đã đọc chưa cung cấp trích đoạn đủ điều kiện cho các yêu cầu nghiên cứu; bản nháp không được giữ như kết luận."
      : "No supported answer. The read content supplied no qualifying excerpts for the research targets; the draft is withheld as a conclusion.";
  const sections = ledger.claimCoverage.map(claim => {
    const quotes = qualifying.filter(item => item.claimIndex === claim.claimIndex);
    const rows = quotes.map(item => `- “${literal(item.quote)}” [${item.marker}]`);
    const gap = input.synthesisUnavailable && !qualifying.length ? vi
      ? "Chưa đánh giá được bằng chứng cho yêu cầu này trong lượt nghiên cứu."
      : "Evidence assessment was unavailable for this research target in this run."
    : vi
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

/** Summary sentences per research target, each above the excerpts that carry it. */
function citedSummary(input: {
  vi: boolean;
  ledger: EvidenceLedger;
  qualifying: EvidenceLedger["evidence"];
  summary: CitedStatement[];
}): string {
  const { vi, ledger, qualifying, summary } = input;
  const intro = vi
    ? "Tóm tắt do mô hình viết, trích dẫn theo từng câu. Sau mỗi câu là nguyên văn đoạn nguồn mà câu đó đã được đối chiếu; câu không có trích đoạn đủ điều kiện đã bị loại."
    : "Model-written summary with sentence-level citations. Each sentence is followed by the verbatim source text it was checked against; sentences without a qualifying excerpt were removed.";
  const sourceText = vi ? "Nguyên văn nguồn" : "Source text";
  const sections = ledger.claimCoverage.map(claim => {
    const quotes = qualifying.filter(item => item.claimIndex === claim.claimIndex);
    const sentences = summary.filter(statement => statement.claimIndex === claim.claimIndex);
    const heading = `### ${vi ? "Yêu cầu nghiên cứu" : "Research target"} ${claim.claimIndex + 1}`;
    const topic = `${vi ? "Chủ đề yêu cầu (chưa xác minh)" : "Requested topic (unverified)"}: “${literal(claim.claim)}”`;
    if (!quotes.length) return [heading, topic, vi
      ? "Thiếu bằng chứng: chưa có trích đoạn đủ điều kiện cho yêu cầu này."
      : "Evidence gap: no qualifying excerpt for this research target."].join("\n\n");
    // The renderer shows paragraphs only, so a sentence and its excerpt share one paragraph.
    const paired = sentences.map(statement =>
      `${literal(statement.text)} [${statement.marker}] ${sourceText}: “${literal(statement.quote)}”`);
    const rest = quotes.filter(item => !sentences.some(statement =>
      statement.marker === item.marker && statement.quote === item.quote));
    return [heading, topic, ...paired,
      ...(rest.length ? [`${sentences.length ? (vi ? "Trích đoạn khác" : "Further excerpts") : (vi ? "Trích đoạn nguồn" : "Source excerpts")}:\n\n${
        rest.map(item => `- “${literal(item.quote)}” [${item.marker}]`).join("\n")}`] : []),
      ...(!(claim.coverage >= MIN_REWARD_SUPPORT) ? [vi
        ? "Thiếu bằng chứng: đánh giá ghi nhận vẫn dưới ngưỡng hỗ trợ cho yêu cầu này."
        : "Evidence gap: the recorded assessment remains below the support threshold for this target."] : []),
    ].join("\n\n");
  });
  const limitations = vi
    ? "Các câu tóm tắt do mô hình viết và mô hình kiểm tra, chưa được xác minh độc lập; chúng không vượt quá nội dung trích đoạn đi kèm và không phải là tổng hợp đầy đủ. Trích đoạn chỉ xác lập mức bám nguồn, không chứng minh tính đúng đắn của nguồn. Nội dung nguồn có thể sai hoặc mâu thuẫn. Trạng thái thanh toán vẫn nằm trong biên nhận riêng."
    : "Summary sentences are model-written and model-checked, not independently verified; they claim no more than their excerpts and are not a complete synthesis. Excerpts establish source grounding, not that a source is correct. Source statements may be wrong or conflicting. Payment states remain in the separate receipt.";
  return [intro, ...sections, limitations].join("\n\n");
}
