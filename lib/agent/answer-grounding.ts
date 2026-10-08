import type { EvidenceLedger } from "./evidence-ledger";
import { MIN_REWARD_SUPPORT } from "./evidence-ledger";
import { researchResponseLanguage } from "./empty-public-evidence";
import type { CitedStatement } from "./cited-statements";
import type { AnswerPresentation } from "../research/answer-presentation";

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
  /** Explicit ordinary-only opt-in; private originals preserve their historical bytes. */
  presentation?: AnswerPresentation;
}): string {
  const { ledger } = input;
  const qualifies = (item: EvidenceLedger["evidence"][number]) => item.qualifiesForAnswer ?? item.qualifiesForReward;
  const vi = (input.presentation?.language ?? researchResponseLanguage(input.question)) === "vi";
  const qualifying = ledger.evidence.filter(item => qualifies(item) && ledger.acceptedMarkers.has(item.marker));
  const summary = (input.statements ?? []).filter(statement => qualifying.some(item =>
    item.claimIndex === statement.claimIndex && item.marker === statement.marker && item.quote === statement.quote));
  const compact = input.presentation && compactSummary(input.presentation, ledger, qualifying, summary);
  if (compact) return compact;
  const withNotice = (body: string) => {
    const count = input.presentation?.requestedBulletCount;
    if (!count) return body;
    const notice = input.presentation!.language === "pt"
      ? `Não foi possível apresentar ${count} tópicos curtos preservando todos os objetivos e trechos qualificados; os objetivos são apresentados abaixo.`
      : vi ? `Chưa thể trình bày ${count} gạch đầu dòng ngắn mà vẫn giữ mọi yêu cầu và trích đoạn đủ điều kiện; các yêu cầu được trình bày bên dưới.`
      : `Could not present ${count} short bullets while preserving every target and qualifying excerpt; the target layout follows.`;
    return `${notice}\n\n${body}`;
  };
  if (input.presentation?.language === "pt") return withNotice(portugueseAnswer(ledger, qualifying, summary, input.synthesisUnavailable));
  if (summary.length) return withNotice(citedSummary({ vi, ledger, qualifying, summary }));
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
  return withNotice([intro, ...sections, limitations].join("\n\n"));
}

/** Group only identical excerpts, retaining every statement, target and cited contribution. */
function compactSummary(presentation: AnswerPresentation, ledger: EvidenceLedger,
  qualifying: EvidenceLedger["evidence"], summary: CitedStatement[]): string | undefined {
  const count = presentation.requestedBulletCount;
  if (!count || !Number.isInteger(count) || count < 1 || count > 8 || !ledger.claimCoverage.length ||
      ledger.claimCoverage.some(claim => !(claim.coverage >= MIN_REWARD_SUPPORT) ||
        !summary.some(statement => statement.claimIndex === claim.claimIndex)) ||
      qualifying.some(item => !summary.some(statement => statement.claimIndex === item.claimIndex &&
        statement.marker === item.marker && statement.quote === item.quote)) ||
      [...ledger.acceptedMarkers].some(marker => !summary.some(statement => statement.marker === marker))) return undefined;
  const groups = new Map<string, CitedStatement[]>();
  for (const statement of summary) {
    const key = JSON.stringify([statement.marker, statement.quote]);
    const group = groups.get(key) ?? [];
    group.push(statement);
    groups.set(key, group);
  }
  if (groups.size !== count) return undefined;
  const copy = {
    en: { source: "Source text", note: "Model-written and model-checked summaries; inspect the paired source excerpts. Full synthesis and source correctness remain unverified. Payment states are recorded separately." },
    vi: { source: "Nguyên văn nguồn", note: "Tóm tắt do mô hình viết và kiểm tra; hãy đối chiếu trích đoạn đi kèm. Chưa xác minh tính đầy đủ của tổng hợp và tính đúng đắn của nguồn. Thanh toán được ghi riêng." },
    pt: { source: "Texto da fonte", note: "Resumos escritos e verificados por modelos; confira os trechos citados. A síntese completa e a exatidão das fontes permanecem não verificadas. Os pagamentos são registrados separadamente." },
  }[presentation.language];
  return [...groups.values()].map(group => `- ${group.map(statement => literal(statement.text)).join(" ")} [${group[0].marker}] ${copy.source}: “${literal(group[0].quote)}”`)
    .concat(copy.note).join("\n\n");
}

/** Portuguese ordinary delivery keeps the same excerpt/statement and gap boundaries. */
function portugueseAnswer(ledger: EvidenceLedger, qualifying: EvidenceLedger["evidence"], summary: CitedStatement[], unavailable?: boolean): string {
  const intro = summary.length
    ? "Resumo escrito por modelo, com citações por frase. Cada frase aparece junto ao trecho original usado na sua verificação."
    : qualifying.length ? "Apenas trechos das fontes; o rascunho foi retido e a síntese completa permanece não verificada."
    : unavailable ? "Não há resposta sustentada: a síntese ou a revisão das evidências não foi concluída. Leituras e recibos originais foram preservados."
    : "Não há resposta sustentada: o conteúdo lido não forneceu trechos qualificados para os objetivos de pesquisa.";
  const sections = ledger.claimCoverage.map(claim => {
    const quotes = qualifying.filter(item => item.claimIndex === claim.claimIndex);
    const sentences = summary.filter(statement => statement.claimIndex === claim.claimIndex);
    const paired = sentences.map(statement => `${literal(statement.text)} [${statement.marker}] Texto da fonte: “${literal(statement.quote)}”`);
    const rest = quotes.filter(item => !sentences.some(statement => statement.marker === item.marker && statement.quote === item.quote));
    return [`### Objetivo de pesquisa ${claim.claimIndex + 1}`, `Tema solicitado (não verificado): “${literal(claim.claim)}”`,
      ...paired, ...rest.map(item => `- “${literal(item.quote)}” [${item.marker}]`),
      ...(!quotes.length ? [unavailable ? "Não foi possível avaliar as evidências deste objetivo nesta execução."
        : "Lacuna de evidência: nenhum trecho qualificado para este objetivo."] : []),
      ...(quotes.length && !(claim.coverage >= MIN_REWARD_SUPPORT)
        ? ["Lacuna de evidência: a avaliação registrada permanece abaixo do limiar de suporte para este objetivo."] : []),
    ].join("\n\n");
  });
  return [intro, ...sections, `${summary.length ? "Frases escritas e verificadas por modelos, sem verificação independente. " : ""}Os trechos estabelecem vínculo com a fonte, mas não comprovam sua exatidão nem uma síntese completa. As fontes podem estar erradas ou em conflito. Os pagamentos são registrados separadamente.`].join("\n\n");
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
