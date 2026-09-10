import { privateReasoningEngine, type PrivateReasoningConfig } from "../llm/private-engine";
import { buyerRequestSchema, requirementSchema } from "../buyer/protocol";
import { acceptPrivateQuote } from "../buyer/private-quote";
import { PRIVATE_RESEARCH_RESOURCE } from "../buyer/private-request-commitment";
import type { PrivateMerchantPolicy } from "../buyer/private-merchant-policy";

/** Backend quote construction only. All options must come from trusted operator configuration.
 * Public routing and private payment admission remain disabled. */
export function createPrivateQuote(requestValue: unknown, options: {
  provider: PrivateReasoningConfig; requirement: unknown; merchants: PrivateMerchantPolicy;
}) {
  const input = buyerRequestSchema.parse(requestValue);
  const requirement = requirementSchema.parse(options.requirement);
  const { disclosure } = privateReasoningEngine(options.provider);
  const request = { ...input, access: "payer-private-v1", model: disclosure.modelId, reasoning: disclosure };
  const budget = BigInt(Math.round(input.budget * 1e6)), total = BigInt(requirement.amount);
  return acceptPrivateQuote({ schema: "keryx-private-quote-v1", resource: PRIVATE_RESEARCH_RESOURCE, request, requirement,
    pricing: { creatorBudgetMicros: budget.toString(), serviceFeeMicros: (total - budget).toString(), totalMicros: total.toString(),
      unusedBudget: "retained-not-refunded", quality: "best-effort" } }, request, options.merchants,
  { maxTotalMicros: "1000000", maxServiceFeeMicros: "1000000" });
}
