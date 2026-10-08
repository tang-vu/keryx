import { paperReferencesBibtex, paperReferencesRis } from "../papers/reference-export";
import type { BibliographicField, BibliographicFieldName, BibliographicOriginalRecord } from "./bibliographic-original-types";

const labels = {
  en: {
    scope: "Original-page bibliography only. Displayed metadata/abstract is distinct from full paper access; no scientific evidence or creator-payment authority.",
    title: "Title", firstAuthor: "First author in original slot 1", identifier: "Exact observed identifier", year: "Year", journal: "Recorded journal", doi: "DOI",
    status: "Explicit page status (literal statement)", absent: "not explicitly recorded in the accepted metadata", bound: "not retained: complete field exceeds the bound",
    conflict: "withheld: original fields disagree", unavailable: "not established: original metadata read unavailable or identity unverified", hidden: "not established: original metadata slot is explicitly hidden",
    peer: "Peer review: unknown. Repository presence and publication type do not establish peer review.",
    authors: "First three original author positions", missingAuthor: "name not retained at this position", provenance: "Field provenance", source: "Original metadata",
    reference: "Short bibliography reference", incomplete: "incomplete contributor names; missing slots are not replaced", noYear: "year not recorded",
    noAuthors: "contributors not recorded", exportGap: "Bibliography exports unavailable: original identity and complete title required.",
    exports: "BibTeX/RIS preserve only verified reference metadata and exact identifier. Their v1 status/peer-review notes describe export limitations; page-specific status remains in the separate field above.",
  },
  fr: {
    scope: "Notice de la page originale uniquement. Les métadonnées/le résumé affichés se distinguent de l’accès au texte intégral ; aucune preuve scientifique ni autorité de paiement de créateur.",
    title: "Titre", firstAuthor: "Premier auteur à la position originale 1", identifier: "Identifiant exact observé", year: "Année", journal: "Revue enregistrée", doi: "DOI",
    status: "Statut explicitement affiché (énoncé littéral)", absent: "non explicitement enregistré dans les métadonnées acceptées", bound: "non conservé : le champ complet dépasse la limite",
    conflict: "non affirmé : les champs originaux divergent", unavailable: "non établi : lecture des métadonnées originales indisponible ou identité non vérifiée", hidden: "non établi : la position originale des métadonnées est explicitement masquée",
    peer: "Évaluation par les pairs : inconnue. La présence dans un dépôt et le type de publication ne l’établissent pas.",
    authors: "Trois premières positions originales des auteurs", missingAuthor: "nom non conservé à cette position", provenance: "Provenance des champs", source: "Métadonnées originales",
    reference: "Référence bibliographique courte", incomplete: "noms incomplets ; aucune position manquante n’est remplacée", noYear: "année non enregistrée",
    noAuthors: "contributeurs non enregistrés", exportGap: "Exports bibliographiques indisponibles : identité originale et titre complet requis.",
    exports: "BibTeX/RIS conservent uniquement les métadonnées bibliographiques vérifiées et l’identifiant exact. Les notes v1 sur le statut/l’évaluation décrivent les limites de l’export ; le statut spécifique à la page reste dans le champ séparé ci-dessus.",
  },
  vi: {
    scope: "Chỉ là thư mục từ trang gốc. Metadata/tóm tắt hiển thị khác với truy cập toàn văn; không có quyền bằng chứng khoa học hay thanh toán tác giả.",
    title: "Tiêu đề", firstAuthor: "Tác giả ở vị trí gốc 1", identifier: "Định danh chính xác đã quan sát", year: "Năm", journal: "Tạp chí ghi nhận", doi: "DOI",
    status: "Trạng thái trang nêu rõ (nguyên văn)", absent: "chưa ghi nhận rõ trong metadata được chấp nhận", bound: "không giữ: trường đầy đủ vượt giới hạn",
    conflict: "không khẳng định: các trường gốc khác nhau", unavailable: "chưa xác lập: không đọc được metadata gốc hoặc chưa xác minh định danh", hidden: "chưa xác lập: vị trí metadata gốc bị ẩn rõ ràng",
    peer: "Phản biện: chưa biết. Có trong kho và loại xuất bản không xác lập phản biện.",
    authors: "Ba vị trí tác giả gốc đầu tiên", missingAuthor: "không giữ được tên ở vị trí này", provenance: "Nguồn từng trường", source: "Metadata gốc",
    reference: "Tham chiếu thư mục ngắn", incomplete: "tên còn thiếu; không thay vị trí thiếu bằng người sau", noYear: "chưa ghi nhận năm",
    noAuthors: "chưa ghi nhận người đóng góp", exportGap: "Chưa xuất thư mục: cần định danh gốc và tiêu đề đầy đủ.",
    exports: "BibTeX/RIS chỉ giữ metadata thư mục đã xác minh và định danh chính xác. Ghi chú trạng thái/phản biện v1 nêu giới hạn của bản xuất; trạng thái riêng của trang nằm trong trường phía trên.",
  },
} as const;
const names: BibliographicFieldName[] = ["title", "firstAuthor", "identifier", "year", "journal", "doi", "status"];

/** Distinct deliverable. No ordinary Citation, citation export, reward weight,
 * settlement, full-text assertion or scientific finding is generated. */
export function bibliographicOriginalDeliverable(record: BibliographicOriginalRecord) {
  const l = labels[record.requested.language], papers = record.paper ? [record.paper] : [];
  const bibtex = paperReferencesBibtex(papers), ris = paperReferencesRis(papers);
  const value = (field: BibliographicField) => field.state === "observed" ? field.value : field.state === "conflict" ? l.conflict
    : field.reason === "over-bound" ? l.bound : field.reason === "read-unavailable" ? l.unavailable : field.reason === "not-visible" ? l.hidden : l.absent;
  const lines = [l.scope, ...names.map(name => `${l[name]}: ${value(record.fields[name])}.`), l.peer,
    `${l.authors}: ${[1, 2, 3].map(position => `${position}. ${record.authors.find(author => author.position === position)?.name ?? l.missingAuthor}`).join("; ")}.`];
  if (record.authorsIncomplete) lines.push(l.incomplete);
  if (record.source) {
    lines.push(`${l.source}: ${record.source.url} (${record.source.observedAt}; SHA-256 ${record.source.bodySha256}).`);
    for (const name of names) {
      const field = record.fields[name];
      if (field.provenance?.length) lines.push(`${l.provenance} (${l[name]}): ${field.provenance.map(item => item.path +
        (item.start !== undefined ? ` [${item.start}, ${item.end})` : "")).join("; ")}.`);
    }
  }
  if (record.paper) {
    const paper = record.paper;
    lines.push(`${l.reference}: ${paper.authors.slice(0, 3).join("; ") || l.noAuthors}${paper.authors.length > 3 ? "; et al." : ""}` +
      `${paper.authorsTruncated ? ` (${l.incomplete})` : ""}. (${paper.publishedYear ?? l.noYear}). ${paper.title}. ` +
      `${paper.venue ? `${paper.venue}. ` : ""}${paper.arxivId ? `arXiv:${paper.arxivId}. ` : ""}${paper.doi ? `DOI: ${paper.doi}. ` : ""}${paper.url}`,
      l.exports, "BibTeX:", "```bibtex", bibtex.content.trimEnd(), "```", "RIS:", "```ris", ris.content.trimEnd(), "```");
  } else lines.push(l.exportGap, "BibTeX: 0. RIS: 0.");
  return { scope: "metadata-only" as const, text: lines.join("\n"), bibliographyExports: { bibtex, ris } };
}
