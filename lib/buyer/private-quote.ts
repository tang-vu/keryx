import { z } from "zod";
import { privateRequestSchema, PRIVATE_RESEARCH_RESOURCE } from "./private-request-commitment";
import { requirementSchema } from "./protocol";
import { requirePrivateMerchant, type PrivateMerchantPolicy } from "./private-merchant-policy";

const micros = z.string().regex(/^(0|[1-9]\d{0,6})$/);
const boundRequest = privateRequestSchema.refine(request => "reasoning" in request,
  "Private quotes require an explicit reasoning policy");
const quoteSchema = z.object({
  schema: z.literal("keryx-private-quote-v1"), resource: z.literal(PRIVATE_RESEARCH_RESOURCE),
  request: boundRequest, requirement: requirementSchema,
  pricing: z.object({ creatorBudgetMicros: micros, serviceFeeMicros: micros, totalMicros: micros,
    unusedBudget: z.literal("retained-not-refunded"), quality: z.literal("best-effort") }).strict(),
}).strict();
export type PrivateQuote = z.infer<typeof quoteSchema>;

/** Validate against independently chosen buyer terms, never just values echoed by a server.
 * No nonce generation, signature, HTTP or settlement occurs here. */
export function acceptPrivateQuote(value: unknown, expectedRequest: unknown, merchants: PrivateMerchantPolicy,
  limits: { maxTotalMicros: string; maxServiceFeeMicros: string }): PrivateQuote {
  const quote = quoteSchema.parse(value);
  const expected = boundRequest.parse(expectedRequest);
  requirePrivateMerchant(quote.requirement, merchants);
  if (JSON.stringify(quote.request) !== JSON.stringify(expected)) throw new Error("Private quote changes the requested research or provider policy");
  const total = BigInt(quote.requirement.amount), budget = BigInt(Math.round(expected.budget * 1e6));
  const maxTotal = BigInt(micros.parse(limits.maxTotalMicros));
  const maxFee = BigInt(micros.parse(limits.maxServiceFeeMicros));
  if (maxTotal > BigInt(1_000_000) || total > maxTotal || total <= budget || total - budget > maxFee)
    throw new Error("Private quote exceeds buyer price limits");
  if (quote.pricing.totalMicros !== total.toString() || quote.pricing.creatorBudgetMicros !== budget.toString()
    || quote.pricing.serviceFeeMicros !== (total - budget).toString()) throw new Error("Private quote pricing is inconsistent");
  return quote;
}
