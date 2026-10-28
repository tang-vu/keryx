import type { Conflict, GatheredContent, SynthesisFailureStage } from "../llm/reasoning-engine";
import { publicReadRecoveryLines, reportLabel, type PublicReadOutcome } from "./read-recovery";
import { synthesisFailureDetail } from "./synthesis-failure";
import { pdfReadingNotice } from "../research/pdf-reading";
import { pdfReadingFrench } from "../../locales/fr/pdf-reading";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";

/** Only observed reading limits and an explicitly unverified conflict flag become next steps.
 * No draft assertions, new citation markers, evidence eligibility or payment authority. */
export function researchFollowUp(input: {
  vi: boolean;
  language?: PresentationLanguage;
  outcomes: PublicReadOutcome[];
  gathered: GatheredContent[];
  conflicts: Conflict[];
  paymentReviewRequired?: boolean;
  synthesisFailure?: SynthesisFailureStage;
}): string {
  const { vi } = input;
  const french = input.language === "fr";
  const rows = publicReadRecoveryLines(input.outcomes, vi, french);
  const synthesis = synthesisFailureDetail(input.synthesisFailure, input.gathered.length, vi, french);
  if (synthesis) rows.unshift(`- ${synthesis}`);
  const limited = input.gathered.filter(source => source.webProvenance?.truncated ||
    source.publicDeliveryKind === "abstract" || source.scholarly?.evidenceScope === "abstract-page" ||
    source.webProvenance?.extraction === "pdf" && Boolean(pdfReadingNotice(source.webProvenance.pdfTextScope)));
  for (const source of limited.slice(0, 8)) {
    const name = reportLabel(source.itemTitle ?? source.sourceName);
    const pdf = source.webProvenance?.extraction === "pdf" ? french
      ? pdfReadingNotice(source.webProvenance.pdfTextScope, false, pdfReadingFrench)
      : pdfReadingNotice(source.webProvenance.pdfTextScope, vi) : "";
    if (pdf) rows.push(`- “${name}”: ${pdf}`);
    else if (source.webProvenance?.truncated) rows.push(french
      ? `- “${name}” : le texte extrait a été tronqué. Lisez la section manquante de la même version avant de conclure sur l'ensemble du document ; conservez cet instantané pour comparaison.` : vi
      ? `- “${name}”: bản trích xuất đã bị cắt. Đọc phần còn thiếu của đúng phiên bản trước khi kết luận về toàn bộ tài liệu; giữ bản đã lưu để đối chiếu.`
      : `- “${name}”: the extracted text was truncated. Read the missing section of the same version before making whole-document conclusions; retain this snapshot for comparison.`);
    if (source.scholarly?.evidenceScope === "abstract-page") rows.push(french
      ? `- “${name}” : seule la page du résumé a été lue. Obtenez le texte intégral de la version exacte avant de comparer des méthodes, évaluations ou limites absentes du résumé.` : vi
      ? `- “${name}”: chỉ đọc được trang tóm tắt. Lấy toàn văn đúng phiên bản trước khi so sánh phương pháp, đánh giá hoặc các giới hạn chưa có trong tóm tắt.`
      : `- “${name}”: only the abstract page was read. Obtain the exact full-text version before comparing methods, evaluations or limitations absent from the abstract.`);
    else if (source.publicDeliveryKind === "abstract") rows.push(french
      ? `- “${name}” : la source n'a fourni qu'un résumé ou une présentation ; la lecture du texte intégral n'est pas établie. Obtenez l'original complet du même document et de la même version pour vérifier les détails absents du texte fourni.` : vi
      ? `- “${name}”: nguồn chỉ cung cấp bản tóm tắt hoặc giới thiệu; chưa xác nhận đã đọc toàn văn. Lấy bản gốc đầy đủ của đúng tài liệu và phiên bản để kiểm tra các chi tiết chưa có trong phần được cung cấp.`
      : `- “${name}”: the source supplied an abstract or summary; full-text reading has not been established. Obtain the complete original of the same document and version to check details absent from the supplied text.`);
  }
  const known = new Set(input.gathered.map(source => source.marker));
  const reportedConflict = input.conflicts.some(conflict =>
    new Set(conflict.positions.filter(position => known.has(position.marker)).map(position => position.marker)).size >= 2);
  if (reportedConflict) rows.push(french
    ? "- Le modèle a signalé des affirmations divergentes entre les sources ; cette évaluation n'est pas vérifiée indépendamment. Comparez les passages originaux et leurs révisions, puis demandez au responsable du document quelle règle ou quel résultat s'applique. La source préférée par le modèle ne résout pas un désaccord." : vi
    ? "- Model báo có khác biệt giữa các nguồn; nhận định này chưa được xác minh độc lập. Đối chiếu nguyên văn và phiên bản, rồi yêu cầu chủ tài liệu xác nhận quy định hoặc kết quả nào áp dụng. Không dùng lựa chọn ưu tiên của model để coi mâu thuẫn đã được giải quyết."
    : "- The model flagged differing source statements; that assessment is not independently verified. Compare the original passages and revisions, then ask the document owner which policy or result applies. The model's preferred source does not resolve a conflict.");
  if (input.paymentReviewRequired) rows.unshift(vi
    ? "- Trước bất kỳ lượt trả phí mới nào, kiểm tra biên nhận và bản ghi thanh toán gốc của lượt này; xử lý trạng thái đang chờ hoặc chưa rõ trước khi mua lại. Lỗi đọc và các bước tiếp tục không xóa khoản đã trả hay khoản còn giữ."
    : "- Before any new paid attempt, inspect this job's original payment receipts and records; resolve pending or unknown outcomes before buying again. Read failures and follow-up steps do not erase recorded charges or reservations.");
  if (!rows.length) return "";
  return [french ? "### Étapes suivantes pour compléter cette recherche" : vi ? "### Việc cần làm để hoàn thiện kết quả" : "### Next steps to complete this research",
    french ? "Ces étapes sont des suggestions ; cette recherche ne les a pas effectuées. Elles ne modifient pas les preuves ni l'état des paiements enregistrés." : vi ? "Các bước dưới đây là hướng dẫn tiếp tục; lượt này chưa tự thực hiện chúng. Chúng không thay đổi bằng chứng hoặc trạng thái thanh toán đã ghi."
      : "These are suggested follow-up steps; this run has not performed them. They do not change the recorded evidence or payment state.",
    ...rows].join("\n\n");
}
