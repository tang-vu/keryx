import type { ProposedEvidence } from "../llm/reasoning-engine";
import type { PresentationLanguage } from "./presentation-language";
import { isPresentationLanguage } from "../../shared/i18n/presentation-language";

// A JSON property on a proposal is never reviewer authority. Keep the observation
// runtime bound, like the existing quote presentation capabilities.
const observations = new WeakMap<ProposedEvidence, { snapshot: string; language: PresentationLanguage }>();
const snapshot = (row: ProposedEvidence) => JSON.stringify([row.claimIndex, row.marker, row.quote, row.statement, row.statementSupport]);

/** Called only on the independently reviewed row, after duplicate/index checks. */
export function observeStatementLanguage(row: ProposedEvidence, value: unknown): void {
  if (row.statement && isPresentationLanguage(value))
    observations.set(row, { snapshot: snapshot(row), language: value });
}

export function reviewedStatementLanguage(row: ProposedEvidence): PresentationLanguage | undefined {
  const observation = observations.get(row);
  return observation?.snapshot === snapshot(row) ? observation.language : undefined;
}

/** Only sentence delivery is filtered; evidence support/reward gates are unchanged. */
export function languageReviewedProposals(rows: ProposedEvidence[], language: PresentationLanguage): ProposedEvidence[] {
  return rows.filter(row => reviewedStatementLanguage(row) === language);
}
