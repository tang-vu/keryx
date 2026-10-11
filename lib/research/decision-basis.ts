import { decimalMicros } from "../research-audit/exact-units";
import type { Decision } from "../types";
import type { CaptureDecision } from "./decision-review-types";

/**
 * Structured purchase basis recorded with every decision when the plan is fixed.
 *
 * The prose rationale remains the readable explanation. These closed fields let a later
 * scorer compare the choice with recorded citations and settlements without parsing prose
 * or asking the model to describe itself. They describe the planning snapshot only: a later
 * funding, review or sufficiency SKIP changes `action`, never this basis. Nothing here is
 * payment authority, a settlement observation or a counterfactual outcome.
 */
export type DecisionRule = CaptureDecision["codeRule"];
export interface DecisionAlternative {
  assetId: string;
  sourceId: string;
  action: Decision["action"];
  expectedValue: number;
  /** Exact quoted access price, or null when the recorded decimal is not a whole micro-USDC. */
  quotedPriceMicroUsdc: string | null;
}
export interface DecisionBasis {
  version: 1;
  /** Action and code rule at planning time. The model's own account is not consulted. */
  plannedAction: Decision["action"];
  rule: DecisionRule;
  quotedPriceMicroUsdc: string | null;
  /** Fetch share of the run budget, floored to whole micro-USDC like the portfolio cap. */
  fetchBudgetMicroUsdc: string;
  /** Fetch budget left before this ledger row, after earlier planned BUYs. Null when unknown. */
  budgetLeftMicroUsdc: string | null;
  /** Best candidate on the other side of the selection boundary, or null when there was none. */
  alternative: DecisionAlternative | null;
}

const RULES: readonly DecisionRule[] = ["model-skip", "selected", "public-read", "external-only", "missing-proposal",
  "discussion", "preview", "attention", "portfolio", "terms-changed", "duplicate", "rights", "funding-unavailable",
  "zero-budget", "budget", "sufficient", "assessment-unavailable", "not-admitted", "cache-expired", "cache-selected"];
const MICROS = /^(0|[1-9]\d{0,15})$/;
const ACTIONS: readonly Decision["action"][] = ["BUY", "SKIP", "CACHE"];
const idOf = (decision: Pick<Decision, "assetId" | "sourceId">) => decision.assetId ?? decision.sourceId;

function plain(value: unknown, names: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).length !== names.length || names.some(name => !fields[name] || !("value" in fields[name]))) return;
    return Object.fromEntries(names.map(name => [name, fields[name].value]));
  } catch { return; }
}
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const unit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const amount = (value: unknown): value is string | null => value === null || typeof value === "string" && MICROS.test(value);

/** Closed read-side validation. Absent or malformed historical data stays absent; nothing is repaired. */
export function parseDecisionBasis(value: unknown): DecisionBasis | undefined {
  const row = plain(value, ["version", "plannedAction", "rule", "quotedPriceMicroUsdc", "fetchBudgetMicroUsdc",
    "budgetLeftMicroUsdc", "alternative"]);
  if (!row || row.version !== 1 || !ACTIONS.includes(row.plannedAction as Decision["action"])
    || !RULES.includes(row.rule as DecisionRule) || !amount(row.quotedPriceMicroUsdc)
    || typeof row.fetchBudgetMicroUsdc !== "string" || !MICROS.test(row.fetchBudgetMicroUsdc)
    || !amount(row.budgetLeftMicroUsdc)) return;
  if (row.budgetLeftMicroUsdc !== null && BigInt(row.budgetLeftMicroUsdc) > BigInt(row.fetchBudgetMicroUsdc)) return;
  let alternative: DecisionAlternative | null = null;
  if (row.alternative !== null) {
    const other = plain(row.alternative, ["assetId", "sourceId", "action", "expectedValue", "quotedPriceMicroUsdc"]);
    if (!other || !identifier(other.assetId) || !identifier(other.sourceId) || !ACTIONS.includes(other.action as Decision["action"])
      || !unit(other.expectedValue) || !amount(other.quotedPriceMicroUsdc)) return;
    alternative = { assetId: other.assetId, sourceId: other.sourceId, action: other.action as Decision["action"],
      expectedValue: other.expectedValue, quotedPriceMicroUsdc: other.quotedPriceMicroUsdc };
  }
  return { version: 1, plannedAction: row.plannedAction as Decision["action"], rule: row.rule as DecisionRule,
    quotedPriceMicroUsdc: row.quotedPriceMicroUsdc, fetchBudgetMicroUsdc: row.fetchBudgetMicroUsdc,
    budgetLeftMicroUsdc: row.budgetLeftMicroUsdc, alternative };
}

function quoted(price: number): string | null {
  const exact = decimalMicros(price);
  return exact !== null && MICROS.test(exact) ? exact : null;
}
/** Higher predicted value first, then the cheaper quote, then a stable identifier order. */
function better(a: Decision, b: Decision): number {
  return b.expectedValue - a.expectedValue || a.price - b.price || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0);
}
function describe(decision: Decision | undefined): DecisionAlternative | null {
  return decision ? { assetId: idOf(decision), sourceId: decision.sourceId, action: decision.action,
    expectedValue: decision.expectedValue, quotedPriceMicroUsdc: quoted(decision.price) } : null;
}

/**
 * Attach the planning basis to an ordered decision ledger. Pure and total: it never changes an
 * action, price, order or rationale, and an unrepresentable amount is recorded as unknown
 * instead of being rounded into a figure nobody signed.
 */
export function withDecisionBasis(decisions: readonly Decision[], input: {
  fetchBudgetUsdc: number;
  ruleFor(decision: Decision): DecisionRule;
}): Decision[] {
  const budget = Number.isFinite(input.fetchBudgetUsdc) && input.fetchBudgetUsdc > 0
    ? BigInt(Math.floor(input.fetchBudgetUsdc * 1_000_000 + 1e-9)) : BigInt(0);
  const rules = decisions.map(decision => input.ruleFor(decision));
  const internal = decisions.map((decision, index) => ({ decision, rule: rules[index] })).filter(row => !row.decision.external);
  const selected = internal.filter(row => row.decision.action !== "SKIP").map(row => row.decision).sort(better);
  // Only a positive proposal the portfolio left unspent is a real alternative to a selected read.
  const passedOver = internal.filter(row => row.decision.action === "SKIP" && row.rule === "portfolio")
    .map(row => row.decision).sort(better);
  let left: bigint | null = budget;
  return decisions.map((decision, index) => {
    const chosen = !decision.external && decision.action !== "SKIP";
    const price = quoted(decision.price);
    const basis: DecisionBasis = { version: 1, plannedAction: decision.action, rule: rules[index],
      quotedPriceMicroUsdc: price, fetchBudgetMicroUsdc: budget.toString(),
      budgetLeftMicroUsdc: left === null ? null : left.toString(),
      alternative: describe((chosen ? passedOver : selected).find(other => other !== decision)) };
    if (!decision.external && decision.action === "BUY" && left !== null)
      left = price === null || BigInt(price) > left ? null : left - BigInt(price);
    return { ...decision, basis };
  });
}
