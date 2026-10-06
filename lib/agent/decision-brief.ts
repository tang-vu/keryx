import { MAX_BRIEF_FACTS, validBriefPacket } from "../llm/decision-brief";
import type { ReviewedDecisionBrief } from "../llm/decision-brief";
import type { EvidenceLedger } from "./evidence-ledger";
import { researchResponseLanguage } from "./empty-public-evidence";

// This matches the small reading renderer. Model/source strings cannot insert
// citation controls or Markdown structures; only the renderer writes markers.
function literal(value: string): string {
  return value.replace(/\[(S\d+)\]/g, "[\u200b$1]").replace(/[`*_#<>]/g, "$&\u200b").replace(/[\r\n]+/g, " ");
}

/** Project reviewed rows through existing evidence/reward authority, downwards only.
 * Contexts stay server-local; the public answer contains only citation-sized excerpts. */
export function deliverDecisionBrief(brief: ReviewedDecisionBrief | undefined, ledger: EvidenceLedger, question: string):
  { answer: string; ledger: EvidenceLedger; digest: string; facts: number; actions: number } | undefined {
  if (!brief) return;
  if (!validBriefPacket(brief.packet) || brief.packet.question !== question ||
    brief.packet.targets.length !== ledger.claimCoverage.length ||
    brief.packet.targets.some((target, index) => target !== ledger.claimCoverage[index]?.claim)) return {
      answer: "", digest: "", facts: 0, actions: 0,
      ledger: { ...ledger, evidence: ledger.evidence.map(item => ({ ...item, qualifiesForAnswer: false, qualifiesForReward: false })),
        acceptedMarkers: new Set(), claimCoverage: ledger.claimCoverage.map(claim => ({ ...claim, coverage: 0, coveredBy: [] })),
        droppedCitations: [...new Set([...ledger.droppedCitations, ...ledger.acceptedMarkers])] },
    };
  const quoteById = new Map(brief.packet.quotes.map(quote => [quote.quoteId, quote]));
  const facts = brief.packet.candidate.facts.filter(fact => brief.facts.some(accepted => accepted.id === fact.id) &&
    fact.quoteIds.every(id => {
      const quote = quoteById.get(id);
      return quote && ledger.acceptedMarkers.has(quote.marker) && ledger.evidence.some(item => item.qualifiesForAnswer &&
        item.claimIndex === fact.targetIndex && item.marker === quote.marker && item.quote === quote.text);
    }));
  const actions = brief.packet.candidate.actions.filter(action => brief.actions.includes(action.id) &&
    action.premiseIds.every(id => facts.some(fact => fact.id === id)));
  const visible = new Set(facts.flatMap(fact => fact.quoteIds.map(id => {
    const quote = quoteById.get(id)!;
    return `${fact.targetIndex}\u0000${quote.marker}\u0000${quote.text}`;
  })));
  const evidence = ledger.evidence.map(item => visible.has(`${item.claimIndex}\u0000${item.marker}\u0000${item.quote}`)
    ? item : { ...item, qualifiesForAnswer: false, qualifiesForReward: false });
  const acceptedMarkers = new Set(evidence.filter(item => item.qualifiesForAnswer).map(item => item.marker));
  const restricted: EvidenceLedger = { ...ledger, evidence, acceptedMarkers,
    droppedCitations: [...new Set([...ledger.droppedCitations, ...[...ledger.acceptedMarkers].filter(marker => !acceptedMarkers.has(marker))])],
    claimCoverage: ledger.claimCoverage.map(claim => {
      const kept = evidence.filter(item => item.claimIndex === claim.claimIndex && item.qualifiesForAnswer);
      return { ...claim, coverage: Math.min(claim.coverage, Math.max(0, ...kept.map(item => item.support))),
        coveredBy: [...new Set(kept.map(item => item.marker))] };
    }) };
  // Even when every full fact fails, surviving legs of those facts must not
  // reappear as paid fallback excerpts. Return the restricted ledger first.
  if (!facts.length) return { answer: "", ledger: restricted, digest: brief.packet.digest, facts: 0, actions: 0 };
  const vi = researchResponseLanguage(question) === "vi";
  const references = (quoteIds: string[]) => [...new Set(quoteIds.map(id => quoteById.get(id)!.marker))].map(marker => `[${marker}]`).join(" ");
  // A generation that used every row may have left a target out for space, not for lack of evidence.
  const capped = brief.packet.candidate.facts.length >= MAX_BRIEF_FACTS;
  const sections = restricted.claimCoverage.map(claim => {
    const rows = facts.filter(fact => fact.targetIndex === claim.claimIndex);
    return [ `### ${vi ? "Yêu cầu" : "Research target"} ${claim.claimIndex + 1}`,
      `${vi ? "Câu hỏi" : "Question"}: “${literal(claim.claim)}”`,
      rows.length ? rows.map(fact => `- ${literal(fact.text)} ${references(fact.quoteIds)}`).join("\n")
        : capped ? vi ? `Bản phân tích giới hạn ${MAX_BRIEF_FACTS} nhận định nên không có nhận định cho yêu cầu này; đây không phải kết luận về bằng chứng.`
          : `This brief is limited to ${MAX_BRIEF_FACTS} statements and has none for this target; that is not a finding about the evidence.`
        : vi ? "Chưa đủ bằng chứng cho yêu cầu này." : "Insufficient evidence for this target.",
      ...(rows.length && claim.coverage < 0.4 ? [vi ? "Đánh giá độ bao phủ vẫn dưới ngưỡng hỗ trợ." : "Recorded coverage remains below the support threshold."] : []) ].join("\n\n");
  });
  if (actions.length) sections.push([`### ${vi ? "Bước tiếp theo có điều kiện" : "Conditional next steps"}`,
    ...actions.map(action => {
      const quoteIds = facts.filter(fact => action.premiseIds.includes(fact.id)).flatMap(fact => fact.quoteIds);
      const conditions = action.conditions.length ? ` ${vi ? "Điều kiện" : "Conditions"}: ${action.conditions.map(literal).join("; ")}.` : "";
      return `- ${literal(action.text)}${conditions} ${references(quoteIds)}`;
    })].join("\n\n"));
  const shownQuoteIds = [...new Set(facts.flatMap(fact => fact.quoteIds))];
  sections.push([`### ${vi ? "Trích đoạn để đối chiếu" : "Evidence to inspect"}`,
    ...shownQuoteIds.map(id => { const quote = quoteById.get(id)!; return `- “${literal(quote.text)}” [${quote.marker}]`; })].join("\n\n"));
  const intro = vi ? "Bản phân tích dựa trên các trích đoạn đã đọc. Nhận định và bước tiếp theo đã qua kiểm tra riêng bằng model; đây là đánh giá có giới hạn, chưa chứng nhận câu trả lời đầy đủ."
    : "Decision brief based on the excerpts read. Statements and next steps received a separate model review; this is a bounded assessment, not certification of a complete answer.";
  const limits = vi ? "Phần nguồn không được đọc vẫn chưa xác minh. Điều kiện trong đề xuất là giả thiết áp dụng, không phải thông tin đã biết về bạn. Hãy đối chiếu trích đoạn và tài liệu gốc; trạng thái thanh toán nằm trong biên nhận."
    : "Unread source content remains unverified. Action conditions describe hypothetical applicability, not known facts about you. Inspect the excerpts and originals; payment states remain in the receipt.";
  return { answer: [intro, ...sections, limits].join("\n\n"), ledger: restricted,
    digest: brief.packet.digest, facts: facts.length, actions: actions.length };
}
