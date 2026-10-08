import { paperReferencesBibtex, paperReferencesRis } from "./reference-export";
import { PAPER_REPOSITORIES, type PaperRecord, type PaperSearchResult } from "./types";

export type BibliographyLanguage = "en" | "fr" | "vi";
const field = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/gu, " ").trim();
const labels = {
  en: {
    scope: "Paper bibliography only; no paper read, model call, citation or creator payment.",
    history: "Records retain their individual observation times; provider availability does not refresh catalog snapshots.",
    title: "Title", authors: "Recorded contributors", first: "First listed author in the recorded complete list",
    firstGap: "First listed author: not established from the incomplete or absent recorded names.",
    firstThree: "First three authors in provider order", orderGap: "Original author positions: not established from incomplete names; no later contributor is promoted into a missing slot.",
    absentAuthor: "not recorded", doiGap: "not recorded; existence not established", version: "Version", versionGap: "no repository version recorded",
    year: "Year", venue: "Venue", missing: "not recorded", names: "names retained", unavailable: "unavailable",
    unknown: "Peer review and withdrawal/replacement status: unknown in this metadata.",
    kind: "Publication kind (repository classification, not page-specific status)", landing: "Landing page", metadata: "Metadata", observed: "observed",
    provenance: "Field provenance", reference: "Short bibliographic reference", incomplete: "incomplete contributor list; original positions unknown",
    noAuthors: "contributors not recorded", noYear: "year not recorded", statusUnavailable: "unavailable; no empty result inferred", statusEmpty: "no matching records accepted",
    statusAvailable: "metadata records returned", exports: "Bibliography exports only; no research evidence or settlement authority. Missing fields are omitted.",
    textNames: "Text shows the first 12 names; the structured record retains the remaining names.",
  },
  fr: {
    scope: "Notice bibliographique uniquement ; aucune lecture du texte intégral, aucun appel de modèle, aucune citation de recherche ni paiement de créateur.",
    history: "Chaque notice conserve sa date d’observation ; la disponibilité du fournisseur ne rafraîchit pas les notices conservées.",
    title: "Titre", authors: "Contributeurs enregistrés", first: "Premier auteur dans la liste complète enregistrée",
    firstGap: "Premier auteur : non établi à partir des noms incomplets ou absents.",
    firstThree: "Trois premiers auteurs dans l’ordre du fournisseur", orderGap: "Positions originales des auteurs : non établies à partir des noms incomplets ; aucun auteur ultérieur ne remplace une position manquante.",
    absentAuthor: "non enregistré", doiGap: "non enregistré ; son existence n’est pas établie", version: "Version", versionGap: "aucune version de dépôt enregistrée",
    year: "Année", venue: "Revue ou actes", missing: "non enregistré", names: "noms conservés", unavailable: "indisponible",
    unknown: "Évaluation par les pairs et statut de retrait/remplacement : inconnus dans ces métadonnées.",
    kind: "Type de publication (classification du dépôt, pas un statut affiché sur la page)", landing: "Page originale", metadata: "Métadonnées", observed: "observées",
    provenance: "Provenance des champs", reference: "Référence bibliographique courte", incomplete: "liste de contributeurs incomplète ; positions originales inconnues",
    noAuthors: "contributeurs non enregistrés", noYear: "année non enregistrée", statusUnavailable: "indisponible ; aucun résultat vide n’est déduit", statusEmpty: "aucune notice correspondante acceptée",
    statusAvailable: "notices de métadonnées retournées", exports: "Exports bibliographiques uniquement ; aucune preuve de recherche ni autorité de règlement. Les champs absents sont omis.",
    textNames: "Le texte affiche les 12 premiers noms ; la notice structurée conserve les autres noms.",
  },
  vi: {
    scope: "Chỉ là thư mục bài nghiên cứu; chưa đọc toàn văn, không gọi model, không tạo citation nghiên cứu hay trả tiền tác giả.",
    history: "Mỗi bản ghi giữ thời điểm quan sát riêng; nhà cung cấp khả dụng không làm mới bản ghi đã lưu.",
    title: "Tiêu đề", authors: "Người đóng góp được ghi nhận", first: "Tác giả đầu tiên trong danh sách đầy đủ đã ghi nhận",
    firstGap: "Tác giả đầu tiên: chưa xác lập từ danh sách tên thiếu hoặc trống.",
    firstThree: "Ba tác giả đầu tiên theo thứ tự nhà cung cấp", orderGap: "Vị trí tác giả gốc: chưa xác lập từ danh sách thiếu tên; không đưa người sau vào vị trí còn thiếu.",
    absentAuthor: "chưa ghi nhận", doiGap: "chưa ghi nhận; chưa xác lập có tồn tại", version: "Phiên bản", versionGap: "chưa ghi nhận phiên bản kho",
    year: "Năm", venue: "Tạp chí hoặc kỷ yếu", missing: "chưa ghi nhận", names: "tên được giữ", unavailable: "không khả dụng",
    unknown: "Phản biện và trạng thái rút/thay thế: chưa xác định trong metadata này.",
    kind: "Loại xuất bản (phân loại kho, không phải trạng thái trên trang)", landing: "Trang gốc", metadata: "Metadata", observed: "quan sát",
    provenance: "Nguồn từng trường", reference: "Tham chiếu thư mục ngắn", incomplete: "danh sách người đóng góp thiếu; chưa xác lập vị trí gốc",
    noAuthors: "chưa ghi nhận người đóng góp", noYear: "chưa ghi nhận năm", statusUnavailable: "không khả dụng; không suy ra kết quả rỗng", statusEmpty: "không nhận bản ghi khớp",
    statusAvailable: "bản ghi metadata trả về", exports: "Chỉ xuất thư mục; không có quyền bằng chứng nghiên cứu hoặc settlement. Bỏ qua trường thiếu.",
    textNames: "Văn bản hiển thị 12 tên đầu; bản ghi có cấu trúc giữ các tên còn lại.",
  },
} as const;

function provenanceFields(record: PaperRecord) {
  if (record.repository === "crossref") return ["title: message.title[0]",
    ...record.authors.length ? ["authors: message.author (provider order; original positions require a complete list)"] : [],
    ...record.publishedYear ? ["year: message.published.date-parts[0][0]"] : [],
    ...record.venue ? ["venue: message.container-title[0]"] : [], "DOI: message.DOI"].join("; ");
  if (record.repository === "arxiv" && new URL(record.metadataUrl).hostname === "export.arxiv.org")
    return ["title: entry/title", ...record.authors.length ? ["authors: entry/author/name (provider order; original positions require a complete list)"] : [],
      ...record.publishedYear ? ["year: entry/published"] : [], "version: entry/id", ...record.doi ? ["DOI: entry/arxiv:doi"] : []].join("; ");
  // Retained publisher snapshots do not carry raw parser fields in the v1 contract.
  return "title, authors, year, venue and identifiers: retained repository metadata snapshot; raw field paths unavailable";
}

export function bibliographyCardText(result: PaperSearchResult, language: BibliographyLanguage = "en") {
  const l = labels[language], records = result.groups.slice(0, 8).map(group => group.record);
  // Both export formats validate every displayed record and exact provenance identity
  // before any bibliography text is handed to hosted or stdio clients.
  const ris = paperReferencesRis(records), bibtex = paperReferencesBibtex(records);
  const lines = [l.scope, `${result.totalWorks} ${language === "fr" ? "notices correspondantes" : language === "vi" ? "công trình khớp" : "matching works"}. ${l.history}`];
  for (const provider of result.providers) lines.push(`${provider.name}: ${provider.status === "unavailable"
    ? l.statusUnavailable : provider.status === "empty" ? l.statusEmpty : `${provider.records} ${l.statusAvailable}`}.`);
  if (!records.length) lines.push("", `${l.title}: ${l.missing}.`, l.firstGap, l.orderGap,
    `${l.year}: ${l.missing}. ${l.venue}: ${l.missing}. DOI: ${l.doiGap}. ${l.version}: ${l.versionGap}.`,
    l.unknown, l.exports, "BibTeX: 0. RIS: 0.");
  for (const record of records) {
    const complete = record.authors.length > 0 && !record.authorsTruncated && record.authorCount === record.authors.length;
    const shortAuthors = record.authors.length ? record.authors.slice(0, 3).map(field).join("; ") +
      (complete ? record.authors.length > 3 ? "; et al." : "" : ` (${l.incomplete})`) : l.noAuthors;
    lines.push("", `${l.title}: ${field(record.title)}`,
      complete ? `${l.first}: ${field(record.authors[0])}.` : l.firstGap,
      complete ? `${l.firstThree}: ${[0, 1, 2].map(index => `${index + 1}. ${record.authors[index] ? field(record.authors[index]) : l.absentAuthor}`).join("; ")}.` : l.orderGap,
      `${l.authors} (${record.authors.length}/${record.authorCount} ${l.names}): ${record.authors.slice(0, 12).map(field).join("; ") || l.unavailable}.` +
        (record.authors.length > 12 ? ` ${l.textNames}` : ""),
      `DOI: ${record.doi ?? l.doiGap}.`,
      `${l.version}: ${record.arxivId ?? l.versionGap}. ${l.year}: ${record.publishedYear ?? l.missing}. ${l.venue}: ${record.venue ? field(record.venue) : l.missing}.`,
      `${l.kind}: ${record.publicationKind}.`, l.unknown,
      `${l.landing}: ${record.url}`,
      `${l.metadata}: ${record.metadataUrl} (${PAPER_REPOSITORIES[record.repository]}; ${l.observed} ${record.metadataObservedAt}).`,
      `${l.provenance}: ${provenanceFields(record)}.`,
      `${l.reference}: ${shortAuthors}. (${record.publishedYear ?? l.noYear}). ${field(record.title)}.${record.venue ? ` ${field(record.venue)}.` : ""} ${record.arxivId ? `arXiv:${record.arxivId}. ` : ""}${record.doi ? `DOI: ${record.doi}. ` : ""}${record.url}`);
  }
  if (result.totalWorks > 8) lines.push(language === "fr" ? `Le texte affiche 8/${result.totalWorks} notices ; les autres restent dans le résultat structuré.`
    : language === "vi" ? `Văn bản hiển thị 8/${result.totalWorks} công trình; bản ghi có cấu trúc giữ phần còn lại.`
    : `Text shows 8/${result.totalWorks} works; the bounded structured result contains the remaining records.`);
  if (records.length) lines.push("", l.exports, "BibTeX:", "```bibtex", bibtex.content.trimEnd(), "```", "RIS:", "```ris", ris.content.trimEnd(), "```");
  return lines.join("\n");
}
