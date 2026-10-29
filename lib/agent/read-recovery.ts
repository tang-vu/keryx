/** Recorded read failures are operations metadata, never evidence about the document. */
export interface PublicReadOutcome { name: string; code: string; assetId?: string }

export function reportLabel(value: string): string {
  return value.normalize("NFC").replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ").trim().slice(0, 160)
    .replace(/[\[\]<>`*_#|]/g, "");
}

const frenchRecovery: Readonly<Record<string, string>> = {
  "publisher-verification-required": "L'éditeur exige une vérification dans le navigateur ; le document n'a donc pas été lu. Fournissez un original public accessible du même document et de la même version ; la page de vérification n'est pas une preuve relative à l'article.",
  "pdf-extraction-unavailable": "L'extraction du texte PDF a échoué. Vérifiez si le PDF contient du texte sélectionnable ou uniquement des images ; obtenez un PDF avec une couche de texte ou le texte de l'éditeur pour le même document et la même version. Cette recherche n'a pas effectué d'OCR.",
  "html-extraction-unavailable": "L'extraction du texte HTML a échoué. Cherchez une édition texte ou PDF du même document et de la même version fournie par l'éditeur ; un aperçu ne remplace pas le contenu original.",
  "article-byte-limit": "Le document dépasse la limite de taille de lecture. Choisissez une section précise ou une édition texte ou PDF plus petite du même éditeur et de la même version ; le document entier n'a pas été lu.",
  "document-identity-changed": "La redirection n'a pas conservé l'identité du document demandé. Fournissez un lien vers la version exacte ; ne comblez pas cette lacune avec une autre version.",
  "empty-or-duplicate-body": "Un contenu vide ou déjà lu n'a pas été ajouté. Examinez l'original et cherchez une source indépendante si une corroboration est nécessaire ; une autre URL ne prouve pas l'indépendance des preuves.",
  "web-operation-limit": "La limite de tentatives ou de durée de lecture a été atteinte. Donnez la priorité à l'original manquant dans une recherche distincte, après examen de son périmètre et de son coût.",
  "invalid-url": "L'URL du document n'est pas valide. Fournissez une URL HTTPS publique de l'original exact.",
  cancelled: "La lecture a été annulée ou sa durée autorisée est écoulée. Conservez le résultat existant et examinez le périmètre avant de demander une nouvelle recherche.",
};

const chineseRecovery: Readonly<Record<string, string>> = {
  "publisher-verification-required": "出版方要求浏览器验证，因此未能读取文档。请提供同一文档、同一版本且可访问的公开原文；验证页面并非有关文章内容的证据。",
  "pdf-extraction-unavailable": "PDF 文本提取失败。请检查 PDF 是否含可选择的文本，还是仅有图片；获取同一文档和版本的文本层 PDF 或出版方文本。本次运行未执行 OCR。",
  "html-extraction-unavailable": "HTML 页面文本提取失败。请查找同一出版方提供的同一文档和版本的文本或 PDF；预览不能替代原文。",
  "article-byte-limit": "文档超出读取大小限制。请选择具体章节，或同一出版方、同一版本的较小文本或 PDF；尚未读完整份文档。",
  "document-identity-changed": "重定向未保留所请求文档的身份。请提供确切版本的链接；不要用其他版本填补此证据缺口。",
  "empty-or-duplicate-body": "内容为空或与已读内容重复，因此未加入。请检查原文；如需佐证，请查找独立来源。不同 URL 不能证明证据独立。",
  "web-operation-limit": "已达到读取次数或时间限制。请先检查范围与费用，再将缺少的原文列为另一项研究的优先目标。",
  "invalid-url": "文档 URL 无效。请提供确切原文的公开 HTTPS URL。",
  cancelled: "读取已取消或超过允许时间。请保留现有结果，并在提出新研究请求前检查范围。",
};

function recovery(code: string, vi: boolean, french = false, chinese = false): string {
  if (chinese) return Object.hasOwn(chineseRecovery, code) ? chineseRecovery[code]
    : "未能获取原文。请检查出版方 URL 的可访问性，并提供同一文档可读取的原文；此失败不能证明文档不存在。";
  if (french) return Object.hasOwn(frenchRecovery, code) ? frenchRecovery[code]
    : "Le texte original n'était pas disponible. Vérifiez l'URL de l'éditeur et fournissez un original accessible du même document ; cet échec ne prouve pas que le document n'existe pas.";
  switch (code) {
    case "publisher-verification-required": return vi
      ? "Nhà xuất bản yêu cầu xác minh trình duyệt nên chưa đọc được tài liệu. Cung cấp bản gốc công khai có thể đọc của đúng tài liệu và phiên bản; trang xác minh không phải bằng chứng về bài báo."
      : "The publisher requires browser verification, so the document was not read. Provide an accessible public original of the same document and version; the verification page is not evidence about the paper.";
    case "pdf-extraction-unavailable": return vi
      ? "Không trích xuất được văn bản PDF. Kiểm tra PDF có văn bản có thể chọn hay chỉ là ảnh; lấy bản PDF có lớp văn bản hoặc bản văn bản từ nhà xuất bản, giữ đúng tài liệu và phiên bản. Lượt này chưa thực hiện OCR."
      : "PDF text extraction failed. Check whether the PDF contains selectable text or only images; obtain a text-layer PDF or publisher text for the same document and version. This run did not perform OCR.";
    case "html-extraction-unavailable": return vi
      ? "Không trích xuất được văn bản trang HTML. Tìm bản văn bản/PDF do cùng nhà xuất bản cung cấp, giữ đúng tài liệu và phiên bản; bản xem trước không thay thế nội dung gốc."
      : "HTML text extraction failed. Look for a publisher-provided text/PDF edition of the same document and version; a preview cannot replace the original content.";
    case "article-byte-limit": return vi
      ? "Tài liệu vượt giới hạn dung lượng đọc. Chọn phần tài liệu cụ thể hoặc bản văn bản/PDF gọn hơn từ cùng nhà xuất bản, giữ đúng phiên bản; chưa đọc được toàn bộ tài liệu."
      : "The document exceeded the read-size limit. Select a specific section or smaller publisher text/PDF edition of the same version; the whole document was not read.";
    case "document-identity-changed": return vi
      ? "Địa chỉ chuyển hướng không giữ đúng danh tính tài liệu yêu cầu. Cung cấp liên kết cho đúng phiên bản; không dùng phiên bản khác để lấp chỗ thiếu."
      : "The redirect did not preserve the requested document identity. Supply a link to the exact version; do not fill this gap with a different version.";
    case "empty-or-duplicate-body": return vi
      ? "Nội dung trống hoặc trùng với bản đã đọc nên không được thêm. Kiểm tra văn bản gốc và tìm nguồn độc lập nếu cần đối chiếu; URL khác không chứng minh có bằng chứng độc lập."
      : "An empty or duplicate body was not added. Inspect the original and seek an independent source if corroboration is needed; another URL does not establish independent evidence.";
    case "web-operation-limit": return vi
      ? "Đã chạm giới hạn số lượt hoặc thời gian đọc. Ưu tiên đúng tài liệu còn thiếu trong một lượt nghiên cứu riêng; cần xem lại chi phí và phạm vi trước khi chạy thêm."
      : "The read-attempt or time limit was reached. Prioritize the missing original in a separate research task after reviewing its scope and cost.";
    case "invalid-url": return vi
      ? "Địa chỉ tài liệu không hợp lệ. Cung cấp URL HTTPS công khai của đúng tài liệu gốc."
      : "The document URL was invalid. Supply a public HTTPS URL for the exact original.";
    case "cancelled": return vi
      ? "Lượt đọc đã bị hủy hoặc hết thời gian cho phép. Giữ kết quả đã có và xem lại phạm vi trước khi yêu cầu một lượt mới."
      : "The read was cancelled or its allowed time elapsed. Keep the existing result and review scope before requesting a new run.";
    default: return vi
      ? "Chưa lấy được văn bản gốc. Kiểm tra khả năng truy cập URL của nhà xuất bản và cung cấp bản gốc có thể đọc của cùng tài liệu; lỗi này không chứng minh tài liệu không tồn tại."
      : "Original text was unavailable. Check the publisher URL and provide an accessible original of the same document; this failure does not establish that the document does not exist.";
  }
}

/** Bounded, deterministic suggestions only. Calling this helper starts no read or purchase. */
export function publicReadRecoveryLines(outcomes: PublicReadOutcome[], vi: boolean, french = false, chinese = false): string[] {
  const unique = new Map<string, PublicReadOutcome>();
  for (const outcome of outcomes) {
    const name = reportLabel(outcome.name) || (chinese ? "公开来源" : french ? "Source publique" : vi ? "Nguồn công khai" : "Public source");
    const key = `${name}\0${outcome.code}`;
    if (!unique.has(key)) unique.set(key, { name, code: outcome.code });
  }
  const entries = [...unique.values()];
  const rows = entries.slice(0, 8).map(outcome => `- “${outcome.name}”: ${recovery(outcome.code, vi, french, chinese)}`);
  if (entries.length > 8) rows.push(chinese ? `- 此任务的跟踪记录中另有 ${entries.length - 8} 次读取失败。` : french ? `- ${entries.length - 8} autres échecs de lecture sont consignés dans la trace de cette recherche.` : vi
    ? `- Còn ${entries.length - 8} lỗi đọc khác trong nhật ký lượt này.`
    : `- ${entries.length - 8} additional read failures are recorded in this run's trace.`);
  return rows;
}
