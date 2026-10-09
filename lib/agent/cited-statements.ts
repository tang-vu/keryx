import type { ProposedEvidence } from "../llm/reasoning-engine";
import { MIN_STATEMENT_SUPPORT, normalizeStatement } from "../llm/cited-statement";
import type { EvidenceLedger } from "./evidence-ledger";
import { retainStatementPresentationItem } from "../llm/quote-presentation-item";

/** A summary sentence and the one ledger excerpt it may be shown beside. */
export interface CitedStatement {
  claimIndex: number;
  marker: string;
  quote: string;
  text: string;
}

const MAX_STATEMENTS_PER_TARGET = 4;

/**
 * Admit model-written sentences for delivery. A sentence survives only when its own quote
 * passed every deterministic ledger gate for the same research target and source marker,
 * and the separate review scored the sentence itself as established by that quote.
 * Selection never adds evidence, raises support or changes reward eligibility.
 */
export function selectCitedStatements(proposals: ProposedEvidence[], ledger: EvidenceLedger,
  maximumPerTarget = MAX_STATEMENTS_PER_TARGET): CitedStatement[] {
  if (!Number.isInteger(maximumPerTarget) || maximumPerTarget < 1 || maximumPerTarget > 32)
    throw new Error("Invalid cited-statement target bound");
  const qualifying = new Set(ledger.evidence
    .filter(item => (item.qualifiesForAnswer ?? item.qualifiesForReward) && ledger.acceptedMarkers.has(item.marker))
    .map(item => key(item.claimIndex, item.marker, item.quote)));
  const seen = new Set<string>();
  const perTarget = new Map<number, number>();
  const statements: CitedStatement[] = [];
  for (const proposal of proposals) {
    const text = normalizeStatement(proposal.statement);
    const quote = typeof proposal.quote === "string" ? proposal.quote.trim() : "";
    if (!text || !(Number(proposal.statementSupport) >= MIN_STATEMENT_SUPPORT)) continue;
    const id = key(proposal.claimIndex, proposal.marker, quote);
    if (!qualifying.has(id) || seen.has(id) || seen.has(text.toLocaleLowerCase("en-US"))) continue;
    const count = perTarget.get(proposal.claimIndex) ?? 0;
    if (count >= maximumPerTarget) continue;
    seen.add(id).add(text.toLocaleLowerCase("en-US"));
    perTarget.set(proposal.claimIndex, count + 1);
    const statement = { claimIndex: proposal.claimIndex, marker: proposal.marker, quote, text };
    retainStatementPresentationItem(proposal, statement, ledger.evidence);
    statements.push(statement);
  }
  return statements;
}

function key(claimIndex: number, marker: string, quote: string): string {
  return JSON.stringify([claimIndex, marker, quote]);
}
