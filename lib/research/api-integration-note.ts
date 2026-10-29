import type { EvidenceLedger } from "../agent/evidence-ledger";
import { extractAnswerMarkers, MIN_REWARD_SUPPORT } from "../agent/evidence-ledger";
import type { CitedStatement } from "../agent/cited-statements";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";
import { nativeAnswerCopy } from "./native-answer-copy";

const copy = {
  de: nativeAnswerCopy("de")!.integration, ja: nativeAnswerCopy("ja")!.integration,
  ko: nativeAnswerCopy("ko")!.integration, hi: nativeAnswerCopy("hi")!.integration,
  id: nativeAnswerCopy("id")!.integration,
  "zh-Hans": { title: "API 集成说明", notice: "以下约束来自已检查的摘录。是否完整适用于该 API、具体版本和平台，以及来源是否正确，仍未核实。",
    constraint: "约束与条件", excerpt: "原文摘录", noSummary: "没有经过检查的摘要；请查看原文摘录", scope: "阅读范围",
    section: "标题章节", bounded: "有读取边界的原文", clipped: "不完整的原文", missing: "缺少的证据", target: "所请求的主题（未核实）",
    noGaps: "每项请求主题都有保留的摘录；这并不证明已完整覆盖。", low: "已记录的评估仍低于证据阈值。",
    next: "实现检查 — 建议", check: "实现前，请用你的具体 API 版本和平台测试这些约束。先补齐缺少的证据；这项检查属于建议，并非来源已证明的结论。" },
  fr: { title: "Note d'intégration API", notice: "Les contraintes ci-dessous proviennent d'extraits vérifiés. Leur applicabilité complète à l'API, à sa version et à la plateforme, ainsi que l'exactitude des sources, restent non vérifiées.",
    constraint: "Contrainte et conditions", excerpt: "Extrait original", noSummary: "Aucun résumé vérifié ; examinez l'extrait original", scope: "Périmètre de lecture",
    section: "section de titre", bounded: "original limité", clipped: "original partiel", missing: "Preuves manquantes", target: "Sujet demandé (non vérifié)",
    noGaps: "Chaque sujet demandé dispose d'un extrait conservé ; cela n'établit pas une couverture complète.", low: "L'évaluation enregistrée reste inférieure au seuil de preuve.",
    next: "Vérification d'implémentation — proposition", check: "Testez ces contraintes avec votre version exacte de l'API et votre plateforme avant l'implémentation. Résolvez d'abord les preuves manquantes ; cette vérification proposée n'est pas une conclusion tirée des sources." },
  en: { title: "API integration note", notice: "Constraints below come from checked excerpts. Complete API/version/platform applicability and source correctness remain unverified.",
    constraint: "Constraint and conditions", excerpt: "Original excerpt", noSummary: "No reviewed summary; inspect the original excerpt", scope: "Read scope",
    section: "heading section", bounded: "bounded original", clipped: "partial original", missing: "Missing evidence", target: "Requested topic (unverified)",
    noGaps: "Each requested topic has a retained excerpt; this does not establish complete coverage.", low: "The recorded assessment remains below the evidence threshold.",
    next: "Implementation check — proposal", check: "Test these constraints against your exact API version and platform before implementation. Resolve the missing evidence first; this proposed check is not a source finding." },
  vi: { title: "Ghi chú tích hợp API", notice: "Các ràng buộc dưới đây dựa trên trích đoạn đã kiểm tra. Chưa xác minh tính đầy đủ cho API/phiên bản/nền tảng hoặc tính đúng đắn của nguồn.",
    constraint: "Ràng buộc và điều kiện", excerpt: "Nguyên văn nguồn", noSummary: "Chưa có tóm tắt đã kiểm tra; hãy đọc trích đoạn gốc", scope: "Phạm vi đã đọc",
    section: "mục", bounded: "nguồn gốc có giới hạn", clipped: "một phần nguồn gốc", missing: "Bằng chứng còn thiếu", target: "Chủ đề được yêu cầu (chưa xác minh)",
    noGaps: "Mỗi chủ đề có trích đoạn được giữ lại; điều này chưa xác nhận đã bao phủ đầy đủ.", low: "Đánh giá được ghi nhận vẫn dưới ngưỡng bằng chứng.",
    next: "Bước kiểm tra triển khai — đề xuất", check: "Thử các ràng buộc với đúng phiên bản API và nền tảng của bạn trước khi triển khai. Làm rõ bằng chứng còn thiếu trước; bước kiểm tra này là đề xuất, không phải kết luận từ nguồn." },
  pt: { title: "Nota de integração de API", notice: "As restrições abaixo vêm de trechos verificados. A aplicabilidade completa à API, versão e plataforma e a exatidão das fontes permanecem não verificadas.",
    constraint: "Restrição e condições", excerpt: "Texto da fonte", noSummary: "Sem resumo revisado; confira o trecho original", scope: "Escopo lido",
    section: "seção", bounded: "original com limites", clipped: "original parcial", missing: "Evidências ausentes", target: "Tema solicitado (não verificado)",
    noGaps: "Cada tema tem um trecho preservado; isso não estabelece cobertura completa.", low: "A avaliação registrada permanece abaixo do limiar de evidência.",
    next: "Verificação de implementação — proposta", check: "Teste as restrições na versão exata da API e plataforma antes da implementação. Resolva primeiro as evidências ausentes; esta verificação é uma proposta, não uma conclusão da fonte." },
  es: { title: "Nota de integración de API", notice: "Las restricciones siguientes proceden de fragmentos revisados. La aplicabilidad completa a la API, versión y plataforma y la exactitud de las fuentes siguen sin verificarse.",
    constraint: "Restricción y condiciones", excerpt: "Texto de la fuente", noSummary: "Sin resumen revisado; consulte el fragmento original", scope: "Alcance leído",
    section: "sección", bounded: "original con límites", clipped: "original parcial", missing: "Evidencia faltante", target: "Tema solicitado (no verificado)",
    noGaps: "Cada tema tiene un fragmento conservado; esto no establece cobertura completa.", low: "La evaluación registrada sigue por debajo del umbral de evidencia.",
    next: "Comprobación de implementación — propuesta", check: "Pruebe las restricciones en la versión exacta de la API y plataforma antes de implementar. Resuelva primero la evidencia faltante; esta comprobación es una propuesta, no una conclusión de la fuente." },
} as const;

// Same small-renderer convention as ordinary grounded answers. Receipt quotes
// stay exact; untrusted text cannot create citation controls or Markdown blocks.
function literal(value: string): string {
  return value.replace(/\[(S\d+)\]/g, "[\u200b$1]").replace(/[`*_]/g, "$&\u200b").replace(/[\r\n\u2028\u2029]+/gu, " ");
}

/** Presentation of an already accepted ledger and selected reviewed statements.
 * No discovery, inference, evidence promotion, model call or payment occurs.
 * Refuse compacting rather than drop any existing marker or quoted condition.
 */
export function apiIntegrationNote(input: { answer: string; ledger: EvidenceLedger; statements: readonly CitedStatement[];
  language: PresentationLanguage }): string | undefined {
  const words = copy[input.language], originalMarkers = extractAnswerMarkers(input.answer);
  const rows = input.ledger.evidence.filter(row => (row.qualifiesForAnswer ?? row.qualifiesForReward)
    && input.ledger.acceptedMarkers.has(row.marker) && originalMarkers.has(row.marker));
  const unique = [...new Map(rows.map(row => [JSON.stringify([row.claimIndex, row.marker, row.quote]), row])).values()];
  if (!unique.length || unique.length > 16 || !input.ledger.claimCoverage.length || input.ledger.claimCoverage.length > 8) return;
  const blocks = unique.map(row => {
    const statement = input.statements.find(item => item.claimIndex === row.claimIndex && item.marker === row.marker && item.quote === row.quote);
    const provenance = row.webProvenance;
    const scope = provenance?.htmlSectionScope ? `${words.section} #${literal(provenance.htmlSectionScope.fragment)}`
      : provenance?.truncated ? words.clipped : words.bounded;
    return [`- **${words.constraint}:** ${statement ? literal(statement.text) : words.noSummary} [${row.marker}]`,
      `${words.excerpt}: “${literal(row.quote)}”`, `${words.scope}: ${scope}.`].join(" ");
  });
  const gaps = input.ledger.claimCoverage.filter(target => !unique.some(row => row.claimIndex === target.claimIndex)
    || target.coverage < MIN_REWARD_SUPPORT).map(target => `- ${words.target}: “${literal(target.claim)}”.${
      unique.some(row => row.claimIndex === target.claimIndex) ? " " + words.low : ""}`);
  const answer = [`### ${words.title}`, words.notice, blocks.join("\n"), `### ${words.missing}`,
    gaps.length ? gaps.join("\n") : words.noGaps, `### ${words.next}`, words.check].filter(Boolean).join("\n\n");
  const markers = extractAnswerMarkers(answer);
  if (answer.length > 12000 || markers.size !== originalMarkers.size || [...markers].some(marker => !originalMarkers.has(marker))) return;
  return answer;
}
