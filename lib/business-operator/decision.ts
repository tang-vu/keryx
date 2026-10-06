import { operatorDecisionSchema, operatorInventorySchema, type OperatorDecision, type OperatorLiquidity } from "./contracts";

function amount(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Invalid operator capacity");
  return BigInt(value);
}

/** Deterministic financial gate around the AI research purchasing agent. No balance
 * is credit, no projection authorizes a signature, and no held order is requeued. */
export function decideOperatorCycle(input: {
  inventory: unknown; liquidity: OperatorLiquidity | null; nowMs: number; acceptancePaused?: boolean;
}): OperatorDecision {
  const observedAt = new Date(input.nowMs).toISOString();
  const decide = (action: OperatorDecision["action"], reason: OperatorDecision["reason"], liquidity: OperatorDecision["liquidity"] = "unknown") =>
    operatorDecisionSchema.parse({ action, reason, liquidity, observedAt });
  if (input.acceptancePaused) return decide("hold", "acceptance-paused");
  const parsed = operatorInventorySchema.safeParse(input.inventory);
  if (!parsed.success) return decide("hold", "incomplete-inventory");
  const inventory = parsed.data;
  const age = input.nowMs - Date.parse(inventory.observedAt);
  if (age < 0 || age > 30_000 || inventory.invalidJobs > 0) return decide("hold", "incomplete-inventory");
  if ((inventory.queuedJobs === 0) !== (inventory.queuedCreatorMicroUsdc === "0") ||
    (inventory.processingJobs + inventory.reviewRequiredJobs === 0) !== (inventory.unfinishedCreatorMicroUsdc === "0") ||
    (inventory.prepaidRequests === 0) !== (inventory.prepaidCreatorMicroUsdc === "0") ||
    amount(inventory.largestCreatorMicroUsdc) > amount(inventory.queuedCreatorMicroUsdc) + amount(inventory.prepaidCreatorMicroUsdc))
    return decide("hold", "incomplete-inventory");
  if (inventory.reviewRequiredJobs > 0) return decide("review", "original-job-needs-review");
  if (inventory.processingJobs > 0) return decide("hold", "another-job-active");
  if (inventory.queuedJobs === 0 && inventory.prepaidRequests === 0) return decide("idle", "no-orders", "not-needed");
  if (!input.liquidity) return decide("hold", "liquidity-unavailable");
  try {
    const funds = input.liquidity;
    const retained = amount(funds.retainedMicroUsdc), confirmed = amount(funds.confirmedMicroUsdc);
    const available = amount(funds.availableMicroUsdc), lifetime = amount(funds.lifetimeCapMicroUsdc);
    const obligations = amount(inventory.queuedCreatorMicroUsdc) + amount(inventory.unfinishedCreatorMicroUsdc) + amount(inventory.prepaidCreatorMicroUsdc);
    if (confirmed > retained || amount(inventory.largestCreatorMicroUsdc) > amount(funds.queryCapMicroUsdc) || retained + obligations > lifetime)
      return decide("review", "policy-cap");
    // Unconfirmed exposure stays held even if Circle has already reflected it in
    // availability. This is deliberately conservative, never inferred free credit.
    const held = retained - confirmed;
    if (held + obligations > available) return decide("hold", "liquidity-short", "short");
    return decide(inventory.queuedJobs > 0 ? "run-next" : "idle", "liquidity-covered", "covered");
  } catch { return decide("hold", "liquidity-unavailable"); }
}
