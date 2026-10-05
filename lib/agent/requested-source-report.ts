import type { Decision, EvidenceRecord } from "../types";
import type { GatheredContent, SourceCandidate } from "../llm";
import type { RequestedSourceNotice } from "../web-research/requested-sources";
import { reportLabel, type PublicReadOutcome } from "./read-recovery";

/** Observed operational status only. Secondary evidence never satisfies an unread original. */
export function requestedSourceReport(input: {
  candidates: Map<string, SourceCandidate>; notices: RequestedSourceNotice[];
  decisions: Decision[]; gathered: GatheredContent[]; evidence: EvidenceRecord[];
  outcomes: PublicReadOutcome[]; vi: boolean; withheld: boolean;
}): string {
  if (!input.candidates.size && !input.notices.length) return "";
  const rows: string[] = [];
  const quoted = (url: string) => `\`${url.replace(/`/g, "%60").replace(/\[(S\d+)\]/g, "[\u200b$1]")}\``;
  for (const [id, candidate] of input.candidates) {
    const requirement = candidate.item!.requestedSource!;
    const read = input.gathered.find(item => item.assetId === id);
    const failure = input.outcomes.find(item => item.assetId === id || !item.assetId && item.name === candidate.name);
    const decision = input.decisions.find(item => (item.assetId ?? item.sourceId) === id);
    let status: string;
    if (input.withheld) status = input.vi ? "Không đọc: truy cập ngoài phạm vi bị tắt cho lượt này." : "Not read: external document access is withheld for this run's scope.";
    else if (read) {
      const qualified = input.evidence.some(item => item.marker === read.marker && item.qualifiesForAnswer);
      status = input.vi
        ? `Đã trích xuất có giới hạn từ ${quoted(read.itemUrl!)}; ${qualified ? "giữ được đoạn trích đủ điều kiện" : "chưa giữ được bằng chứng đủ điều kiện"}.`
        : `Bounded text extracted from ${quoted(read.itemUrl!)}; ${qualified ? "qualifying excerpts retained" : "no qualifying evidence retained"}.`;
      if (read.webProvenance?.truncated) status += input.vi ? " Bản trích xuất bị cắt." : " Extraction was truncated.";
      if (read.publicDeliveryKind === "abstract" || read.scholarly?.evidenceScope === "abstract-page") status += input.vi
        ? " Chỉ đọc trang tóm tắt; toàn văn bài báo chưa có."
        : " Only the abstract page was read; full-paper evidence is unavailable.";
    } else if (failure) status = input.vi ? `Đọc thất bại: ${reportLabel(failure.code)}.` : `Read failed: ${reportLabel(failure.code)}.`;
    else status = `${decision?.action === "SKIP" ? "SKIP" : input.vi ? "Chưa đọc" : "Not read"}: ${reportLabel(decision?.rationale ?? (input.vi ? "Chưa hoàn tất lượt đọc trong giới hạn lượt này." : "A read did not complete within this run's limits."))}`;
    if (requirement.urls.some(url => new URL(url).hash)) status += input.vi
      ? " URL có phần neo; trình đọc chỉ thử trích xuất toàn tài liệu có giới hạn, không nhắm riêng phần đó."
      : " A section fragment was supplied; the reader only attempts bounded whole-document extraction, not that section specifically.";
    rows.push(`- ${requirement.urls.map(quoted).join(", ")}: ${status}`);
  }
  for (const notice of input.notices) rows.push(`- ${quoted(notice.url)}: ${reportLabel(notice.reason)}`);
  return [input.vi ? "### Trạng thái nguồn gốc đã cung cấp" : "### Supplied original source status", ...rows].join("\n\n");
}
