import { z } from "zod";
import { addressSchema, BUYER_NETWORK } from "../buyer/protocol";
import { privateMerchantPolicySchema } from "../buyer/private-merchant-policy";
import { privateReasoningEngine } from "../llm/private-engine";
import { reservedResearchMerchants } from "../payments/public-merchant-guard";

const activeSchema = z.object({
  KERYX_PRIVATE_RESEARCH_PAYEE: addressSchema,
  KERYX_PRIVATE_TREASURY_ADDRESS: addressSchema,
  KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: z.string().regex(/^[1-9]\d{0,11}$/),
  KERYX_PRIVATE_SERVICE_FEE_MICROS: z.string().regex(/^[1-9]\d{0,5}$/).refine(value => Number(value) <= 500000),
  KERYX_PRIVATE_MODEL_ID: z.string().min(1),
  KERYX_PRIVATE_PROVIDER: z.enum(["deepseek", "mimo"]),
  KERYX_PRIVATE_PROVIDER_BASE_URL: z.string().url(),
  KERYX_PRIVATE_PROVIDER_API_KEY: z.string().min(1),
  KERYX_PRIVATE_APPROVED_ENDPOINTS: z.string().min(1).max(16384),
  KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: z.string().min(1),
});

/** Backend bootstrap only. Context addresses must come from actual configured signer instances,
 * never an HTTP request. Does not construct a payment signer, read keys, fund or enable a route.
 * API credentials in the return value are server-only and must never enter logs or responses. */
export function privateRuntimePolicy(env: Readonly<Record<string, string | undefined>>, context: {
  network: string; publicSeller: string; publicTreasurySigners: string[]; privateTreasurySigner: string;
}) {
  const flag = env.KERYX_PRIVATE_RESEARCH_ENABLED;
  if (flag === undefined || flag === "0") return null;
  if (flag !== "1") throw new Error("Invalid private research enable flag");
  try {
    const config = activeSchema.parse(env);
    if (context.network !== BUYER_NETWORK) throw new Error();
    const merchants = privateMerchantPolicySchema.parse({ privatePayee: config.KERYX_PRIVATE_RESEARCH_PAYEE,
      publicResearchPayee: context.publicSeller });
    const reserved = reservedResearchMerchants(config.KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES, context.publicSeller);
    if (!reserved.has(merchants.privatePayee.toLowerCase())) throw new Error();
    const publicSigners = z.array(addressSchema).min(1).parse(context.publicTreasurySigners).map(address => address.toLowerCase());
    const signer = addressSchema.parse(context.privateTreasurySigner).toLowerCase();
    if (signer !== config.KERYX_PRIVATE_TREASURY_ADDRESS.toLowerCase() || publicSigners.includes(signer)
      || signer === merchants.publicResearchPayee.toLowerCase() || signer === merchants.privatePayee.toLowerCase()
      || publicSigners.includes(merchants.privatePayee.toLowerCase()) || reserved.has(signer)) throw new Error();
    const provider = { modelId: config.KERYX_PRIVATE_MODEL_ID, provider: config.KERYX_PRIVATE_PROVIDER,
      baseUrl: config.KERYX_PRIVATE_PROVIDER_BASE_URL, apiKey: config.KERYX_PRIVATE_PROVIDER_API_KEY };
    const { disclosure } = privateReasoningEngine(provider);
    const approved = z.array(z.string().url()).min(1).max(16).parse(JSON.parse(config.KERYX_PRIVATE_APPROVED_ENDPOINTS));
    if (!approved.includes(disclosure.endpoint)) throw new Error();
    return { merchants, provider, disclosure, serviceFeeMicros: config.KERYX_PRIVATE_SERVICE_FEE_MICROS,
      treasury: { signer, capacityMicros: config.KERYX_PRIVATE_TREASURY_CAPACITY_MICROS } };
  } catch {
    // Zod/URL/JSON failures may include credentials or operator input; never propagate them.
    throw new Error("Private research runtime policy unavailable");
  }
}
