import type { ProposedEvidence } from "./reasoning-engine";
import { MAX_REVIEWED_EVIDENCE } from "./evidence-review";

/** Extra ordinary-summary judgments. These model declarations can only withhold
 * existing support; they do not certify source truth or a useful deliverable. */
export const ORDINARY_SCOPE_REVIEW_GUIDANCE =
  " For each row, explicitly judge questionScope as direct, related, unrelated or unknown. " +
  "Direct means the quoted fact answers a requested part for the requested subject, actor, system and conditions. " +
  "A plausible analogy or an action in a different domain is related, not direct. " +
  "In supportedFact, write one clause of at most 320 characters stating what this source establishes, retaining its subject and limits. " +
  "For example, a policy limiting arXiv paper submissions does not establish how a customer's public API should handle request spikes. " +
  "Do not turn that moderation policy into API configuration advice; mark questionScope related and give no answer support. " +
  "A definition of HTTP 429 in the requested API documentation can directly answer which response represents rate limiting. " +
  "For every statement, also judge statementScope as preserved, generalized or unknown. " +
  "Preserved requires every actor, domain, condition and limitation to remain within the source's actual assertion. " +
  "Changing a description of one product into a recommendation or guarantee for another system is generalized, even if sensible. " +
  "A receipt digest establishes a retained-byte binding, not independent factual correctness or external provenance. " +
  "Do not use source titles, domains, user context or prior knowledge to fill missing assertions. " +
  "If scope is related, unrelated, generalized or unknown, withhold the corresponding support instead of awarding partial credit for topical similarity. ";

export function ordinaryScopeReviewSchema(observeLanguage: boolean): string {
  return '{"reviews":[{"index":number,"supportedFact":string(max320characters),' +
    '"questionScope":"direct"|"related"|"unrelated"|"unknown","support":number(0..1),' +
    '"statementSupport":number(0..1) when the row has a statement,' +
    '"statementScope":"preserved"|"generalized"|"unknown" when the row has a statement' +
    (observeLanguage ? ',"statementLanguage":"en"|"vi"|"pt"|"es"|"fr"|"zh-Hans"|"de"|"ja"|"ko"|"hi"|"id"|"ru"|"UNKNOWN" when the row has a statement' : "") + '}]}';
}

function data(value: unknown): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some(field => !("value" in field))) return;
    return Object.fromEntries(Object.entries(descriptors).map(([key, field]) => [key, field.value]));
  } catch { return; }
}

/** Preserve rows/duplicates for the existing verifier, replacing missing or
 * incompatible scope with zero. Scores and language never acquire new authority. */
export function ordinaryScopeReviewedResponse(response: unknown, proposals: readonly ProposedEvidence[]): unknown {
  const outer = data(response);
  if (!Array.isArray(outer?.reviews) || outer.reviews.length > MAX_REVIEWED_EVIDENCE) return { reviews: [] };
  return { reviews: outer.reviews.map(value => {
    const row = data(value);
    if (!row) return { support: 0, statementSupport: 0 };
    const proposal = Number.isInteger(row.index) && Number(row.index) >= 0 ? proposals[Number(row.index)] : undefined;
    const fact = typeof row.supportedFact === "string" ? row.supportedFact.trim() : "";
    const direct = Boolean(proposal) && fact.length > 0 && fact.length <= 320 && row.questionScope === "direct";
    return { index: row.index, supportedFact: fact,
      support: direct ? row.support : 0,
      statementSupport: direct && row.statementScope === "preserved" ? row.statementSupport : 0,
      statementLanguage: row.statementLanguage };
  }) };
}
