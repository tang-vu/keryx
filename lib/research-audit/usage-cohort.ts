/** These facts must come from a reviewed server/ledger adapter, never public request telemetry. */
export interface CohortFacts {
  actor: "outside" | "team" | "unknown";
  funding: "independent" | "treasury" | "team" | "sponsored" | "unknown";
  scripted: boolean;
}
export type UsageCohort = "outside" | "team" | "scripted" | "unknown";
export interface CohortClassification {
  cohort: UsageCohort;
  payment: "independent" | "sponsored" | "team" | "unknown";
}

/** Funding evidence never turns an unknown actor or a treasury-funded payer into an outside payer. */
export function classifyUsage(facts: CohortFacts): CohortClassification {
  if (!facts || !["outside", "team", "unknown"].includes(facts.actor)
    || !["independent", "treasury", "team", "sponsored", "unknown"].includes(facts.funding)
    || typeof facts.scripted !== "boolean") throw new Error("Invalid cohort facts");
  const payment = facts.funding === "treasury" || facts.funding === "team" ? "team"
    : facts.funding === "independent" && facts.actor === "outside" ? "independent"
    : facts.funding === "sponsored" && facts.actor === "outside" ? "sponsored" : "unknown";
  const cohort = facts.scripted ? "scripted" : facts.actor;
  return { cohort, payment: cohort === "team" || cohort === "scripted" ? "team" : payment };
}

/** An execution channel alone (web/MCP/engine) cannot identify a person or their funding. */
export function historicalUsage(): CohortClassification {
  return { cohort: "unknown", payment: "unknown" };
}

export function publicHistoryIncludes(cohort: UsageCohort, outsideOnly = false): boolean {
  if (!["outside", "team", "scripted", "unknown"].includes(cohort)) return false;
  return outsideOnly ? cohort === "outside" : cohort !== "scripted";
}
