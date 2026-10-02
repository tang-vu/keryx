import { createHash } from "node:crypto";
import { quoteA2aResearch } from "../a2a/pricing";
import { monthlyQuoteSchema } from "./protocol";
import { config } from "../config";

export function quoteResearchMonthly() {
  const regular = quoteA2aResearch(undefined, "deep", "1.0.0");
  if (!regular.researchPackage || config.networkId !== "eip155:5042002") throw new Error("Monthly unavailable");
  const creatorBudgetMicros = Math.round(regular.creatorBudgetUsdc * 1e6);
  const separateTotalMicros = 4 * Math.round(regular.totalPriceUsdc * 1e6);
  // Equal per-request allocations, rounded upward; never reduce creator funds.
  const totalMicros = Math.ceil(separateTotalMicros * 9 / 40) * 4;
  const serviceFeeMicros = totalMicros - 4 * creatorBudgetMicros;
  const fields = { plan: "research-monthly-v1" as const, requests: 4 as const, termDays: 30 as const,
    researchMode: "deep" as const, packageVersion: "1.0.0" as const, creatorBudgetMicros,
    serviceFeeMicros, totalMicros, separateTotalMicros, roundingMicros: totalMicros - Math.ceil(separateTotalMicros * .9),
    payee: config.sellerAddress, network: "eip155:5042002" as const };
  return monthlyQuoteSchema.parse({ ...fields, quoteId: createHash("sha256").update(JSON.stringify(fields)).digest("hex") });
}
