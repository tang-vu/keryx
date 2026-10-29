import type { Decision, EvidenceRecord } from "../types";
import type { GatheredContent, SourceCandidate } from "../llm";
import type { RequestedSourceNotice } from "../web-research/requested-sources";
import { reportLabel, type PublicReadOutcome } from "./read-recovery";

/** Observed operational status only. Secondary evidence never satisfies an unread original. */
export function requestedSourceReport(input: {
  candidates: Map<string, SourceCandidate>; notices: RequestedSourceNotice[];
  decisions: Decision[]; gathered: GatheredContent[]; evidence: EvidenceRecord[];
  outcomes: PublicReadOutcome[]; vi: boolean; withheld: boolean;
  /** Ordinary renderer selection only; diagnostics and original URLs stay verbatim. */
  language?: import("../../shared/i18n/presentation-language").PresentationLanguage;
}): string {
  if (!input.candidates.size && !input.notices.length) return "";
  const pt = input.language === "pt";
  const fr = input.language === "fr";
  const chinese = input.language === "zh-Hans";
  const rows: string[] = [];
  const quoted = (url: string) => `\`${url.replace(/`/g, "%60").replace(/\[(S\d+)\]/g, "[\u200b$1]")}\``;
  for (const [id, candidate] of input.candidates) {
    const requirement = candidate.item!.requestedSource!;
    const read = input.gathered.find(item => item.assetId === id);
    const failure = input.outcomes.find(item => item.assetId === id || !item.assetId && item.name === candidate.name);
    const decision = input.decisions.find(item => (item.assetId ?? item.sourceId) === id);
    let status: string;
    if (input.withheld) status = chinese ? "未读取：本次运行的范围不允许访问外部文档。" : fr ? "Non lu : l'accès aux documents externes est exclu du périmètre de cette recherche." : pt ? "Não lida: o acesso a documentos externos está desativado no escopo desta execução." : input.vi ? "Không đọc: truy cập ngoài phạm vi bị tắt cho lượt này." : "Not read: external document access is withheld for this run's scope.";
    else if (read) {
      const qualified = input.evidence.some(item => item.marker === read.marker && item.qualifiesForAnswer);
      status = chinese
        ? `已从 ${quoted(read.itemUrl!)} 提取有读取边界的文本；${qualified ? "保留了获准使用的摘录" : "未保留获准使用的证据"}。` : fr
        ? `Texte extrait dans les limites prévues depuis ${quoted(read.itemUrl!)} ; ${qualified ? "extraits admis conservés" : "aucune preuve admise conservée"}.`
        : pt
        ? `Texto extraído com limites de ${quoted(read.itemUrl!)}; ${qualified ? "trechos qualificados preservados" : "nenhuma evidência qualificada preservada"}.`
        : input.vi
        ? `Đã trích xuất có giới hạn từ ${quoted(read.itemUrl!)}; ${qualified ? "giữ được đoạn trích đủ điều kiện" : "chưa giữ được bằng chứng đủ điều kiện"}.`
        : `Bounded text extracted from ${quoted(read.itemUrl!)}; ${qualified ? "qualifying excerpts retained" : "no qualifying evidence retained"}.`;
      if (read.webProvenance?.truncated) status += chinese ? " 提取已被截断。" : fr ? " L'extraction a été tronquée." : pt ? " A extração foi truncada." : input.vi ? " Bản trích xuất bị cắt." : " Extraction was truncated.";
      if (read.publicDeliveryKind === "abstract" || read.scholarly?.evidenceScope === "abstract-page") status += chinese
        ? " 仅读取了摘要页面；全文证据不可用。" : fr
        ? " Seule la page du résumé a été lue ; les preuves du texte intégral ne sont pas disponibles." : pt
        ? " Apenas a página do resumo foi lida; a evidência do artigo completo não está disponível."
        : input.vi
        ? " Chỉ đọc trang tóm tắt; toàn văn bài báo chưa có."
        : " Only the abstract page was read; full-paper evidence is unavailable.";
    } else if (failure) status = chinese ? `读取失败：${reportLabel(failure.code)}。` : fr ? `Échec de lecture : ${reportLabel(failure.code)}.` : pt ? `Falha na leitura: ${reportLabel(failure.code)}.` : input.vi ? `Đọc thất bại: ${reportLabel(failure.code)}.` : `Read failed: ${reportLabel(failure.code)}.`;
    else status = `${decision?.action === "SKIP" ? "SKIP" : chinese ? "未读取" : fr ? "Non lu" : pt ? "Não lida" : input.vi ? "Chưa đọc" : "Not read"}: ${reportLabel(decision?.rationale ?? (chinese ? "未能在本次运行的限制内完成读取。" : fr ? "La lecture n'a pas abouti dans les limites de cette recherche." : pt ? "A leitura não foi concluída dentro dos limites desta execução." : input.vi ? "Chưa hoàn tất lượt đọc trong giới hạn lượt này." : "A read did not complete within this run's limits."))}`;
    const section = input.withheld ? undefined : read?.webProvenance?.htmlSectionScope;
    if (section) status += chinese
      ? ` 仅读取了标题章节 ${quoted("#" + section.fragment)}；尚未读取文档其余部分。` : fr
      ? ` Seule la section ${quoted("#" + section.fragment)} a été lue ; le reste du document n'a pas été lu.` : pt
      ? ` Foi lida apenas a seção ${quoted("#" + section.fragment)}; o restante do documento não foi lido.`
      : input.vi
      ? ` Chỉ đọc mục ${quoted("#" + section.fragment)}; phần còn lại của tài liệu chưa được đọc.`
      : ` Only heading section ${quoted("#" + section.fragment)} was read; the surrounding document was not read.`;
    else if (requirement.urls.some(url => new URL(url).hash) && (!read || input.withheld)) status += chinese
      ? " 已提供章节锚点；尚未确认已读取所请求的章节。" : fr
      ? " Une ancre de section a été fournie ; la lecture de la section demandée n'a pas été établie." : pt
      ? " Foi fornecido um fragmento; a leitura da seção solicitada não foi estabelecida."
      : input.vi ? " URL có phần neo; chưa xác nhận đã đọc được mục được yêu cầu."
      : " A section fragment was supplied; a read of the requested section has not been established.";
    else if (requirement.urls.some(url => new URL(url).hash)) status += chinese
      ? " 已提供章节锚点；读取器仅尝试有边界的整份文档提取，并非专门读取该章节。" : fr
      ? " Une ancre de section a été fournie ; le lecteur tente uniquement l'extraction limitée du document entier, sans cibler cette section." : pt
      ? " Foi fornecido um fragmento de seção; o leitor tenta apenas a extração limitada do documento completo, não daquela seção em particular."
      : input.vi
      ? " URL có phần neo; trình đọc chỉ thử trích xuất toàn tài liệu có giới hạn, không nhắm riêng phần đó."
      : " A section fragment was supplied; the reader only attempts bounded whole-document extraction, not that section specifically.";
    rows.push(`- ${requirement.urls.map(quoted).join(", ")}: ${status}`);
  }
  for (const notice of input.notices) rows.push(`- ${quoted(notice.url)}: ${reportLabel(notice.reason)}`);
  return [chinese ? "### 所提供原文的状态" : fr ? "### État des sources originales fournies" : pt ? "### Estado das fontes originais fornecidas" : input.vi ? "### Trạng thái nguồn gốc đã cung cấp" : "### Supplied original source status", ...rows].join("\n\n");
}
