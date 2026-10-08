import type { BibliographicTaskResult } from "./bibliographic-task";

const labels = {
  en: { heading: "Bibliographic record", title: "Title", firstAuthor: "First author", identifier: "Identifier", year: "Year", journal: "Journal", doi: "DOI", status: "Page status", missing: "not established from the original metadata", authors: "First three authors", source: "Original metadata", scope: "Metadata only; full paper and peer review have not been verified." },
  fr: { heading: "Notice bibliographique", title: "Titre", firstAuthor: "Premier auteur", identifier: "Identifiant", year: "Année", journal: "Revue", doi: "DOI", status: "Statut de la page", missing: "non établi dans les métadonnées originales", authors: "Trois premiers auteurs", source: "Métadonnées originales", scope: "Métadonnées uniquement ; le texte intégral et l’évaluation par les pairs ne sont pas vérifiés." },
  vi: { heading: "Thông tin thư mục", title: "Tiêu đề", firstAuthor: "Tác giả đầu tiên", identifier: "Định danh", year: "Năm", journal: "Tạp chí", doi: "DOI", status: "Trạng thái trang", missing: "chưa xác lập từ metadata gốc", authors: "Ba tác giả đầu tiên", source: "Metadata gốc", scope: "Chỉ là metadata; chưa xác minh toàn văn hoặc phản biện." },
} as const;
const literal = (value: string) => value.replace(/([\\`*_{}\[\]<>#|])/gu, "\\$1").replace(/[\r\n]+/gu, " ");

/** Concise caller-scoped presentation; complete field provenance and reference
 * downloads remain in the separate bibliography result, outside cited evidence. */
export function bibliographicTaskAnswer(result: BibliographicTaskResult): string {
  const l = labels[result.record.requested.language];
  const fields = result.requestedFields.filter(field => !(field === "firstAuthor" && result.requestedAuthorCount === 3));
  const lines = [`### ${l.heading}`, "", ...fields.map(name => {
    const field = result.record.fields[name];
    return `- ${l[name]}: ${field.state === "observed" ? literal(field.value) : l.missing}.`;
  })];
  if (result.requestedAuthorCount === 3) lines.push(`- ${l.authors}: ${[1, 2, 3].map(position =>
    `${position}. ${literal(result.record.authors.find(author => author.position === position)?.name ?? l.missing)}`).join("; ")}.`);
  if (result.record.source) lines.push("", `${l.source}: ${result.record.source.url}`);
  lines.push("", l.scope);
  return lines.join("\n");
}
