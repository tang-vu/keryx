import { createHash } from "node:crypto";
import { quoteA2aResearch } from "../a2a/pricing";
import { monthlyQuoteSchemaForProfile } from "./protocol";
import { config } from "../config";

export function quoteResearchMonthly() {
  const regular = quoteA2aResearch(undefined, "deep", "1.0.0");
  if (!regular.researchPackage) throw new Error("Monthly unavailable");
  const creatorBudgetMicros = Math.round(regular.creatorBudgetUsdc * 1e6);
  const perRequestMicros = Math.round(regular.totalPriceUsdc * 1e6);
  if (!Number.isSafeInteger(creatorBudgetMicros) || creatorBudgetMicros < 1 ||
    !Number.isSafeInteger(perRequestMicros) || perRequestMicros < 1) throw new Error("Monthly economics refused");
  const separate = BigInt(4) * BigInt(perRequestMicros);
  const total = ((separate * BigInt(9) + BigInt(39)) / BigInt(40)) * BigInt(4);
  if (separate > BigInt(Number.MAX_SAFE_INTEGER) || total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Monthly economics refused");
  const separateTotalMicros = Number(separate);
  // Equal per-request allocations, rounded upward; never reduce creator funds.
  const totalMicros = Number(total);
  const serviceFeeMicros = totalMicros - 4 * creatorBudgetMicros;
  const fields = { plan: "research-monthly-v1" as const, requests: 4 as const, termDays: 30 as const,
    researchMode: "deep" as const, packageVersion: "1.0.0" as const, creatorBudgetMicros,
    serviceFeeMicros, totalMicros, separateTotalMicros, roundingMicros: Number(total - (separate * BigInt(9) + BigInt(9)) / BigInt(10)),
    payee: config.sellerAddress, network: config.profile.networkId };
  return monthlyQuoteSchemaForProfile(config.profile).parse({ ...fields, quoteId: createHash("sha256").update(JSON.stringify(fields)).digest("hex") });
}
