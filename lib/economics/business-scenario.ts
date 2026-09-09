import { z } from "zod";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const USD_SCALE = BigInt(1_000_000);
// USD inputs are explicit operator estimates, never imported from testnet volume.
const money = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/);
const unknownMoney = money.nullable();
export const businessScenarioSchema = z.object({
  basis: z.enum(["illustrative", "operator-estimate"]),
  paidJobsPerMonth: z.number().int().min(0).max(1_000_000_000).nullable(),
  serviceFeeUsdPerJob: money,
  creatorBudgetUsdPerJob: money,
  creatorSpendUsdPerJob: unknownMoney,
  variableCostUsdPerJob: z.object({
    llm: unknownMoney, infrastructure: unknownMoney, paymentAndGas: unknownMoney,
    support: unknownMoney, refundAndLoss: unknownMoney,
  }).strict(),
  fixedMonthlyUsd: unknownMoney,
  acquisitionMonthlyUsd: unknownMoney,
}).strict().refine(input => input.creatorSpendUsdPerJob === null
  || micros(input.creatorSpendUsdPerJob) <= micros(input.creatorBudgetUsdPerJob),
"Creator spend cannot exceed the package creator budget");

function micros(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * USD_SCALE + BigInt(fraction.padEnd(6, "0"));
}

function usd(value: bigint | null): string | null {
  if (value === null) return null;
  const absolute = value < ZERO ? -value : value;
  return `${value < ZERO ? "-" : ""}${absolute / USD_SCALE}.${String(absolute % USD_SCALE).padStart(6, "0")}`;
}

function sumKnown(values: (string | null)[]): bigint | null {
  return values.some(value => value === null) ? null
    : values.reduce<bigint>((total, value) => total + micros(value!), ZERO);
}

/** Arithmetic only. No pricing change, external request, payment or realized-profit claim. */
export function calculateBusinessScenario(value: unknown) {
  const input = businessScenarioSchema.parse(value);
  const count = input.paidJobsPerMonth === null ? null : BigInt(input.paidJobsPerMonth);
  const fee = micros(input.serviceFeeUsdPerJob);
  const budget = micros(input.creatorBudgetUsdPerJob);
  const spend = input.creatorSpendUsdPerJob === null ? null : micros(input.creatorSpendUsdPerJob);
  const variable = sumKnown(Object.values(input.variableCostUsdPerJob));
  const fixed = sumKnown([input.fixedMonthlyUsd, input.acquisitionMonthlyUsd]);
  const monthly = (amount: bigint | null) => amount === null || count === null ? null : amount * count;
  const contribution = (perJob: bigint | null) => ({
    perJobUsd: usd(perJob),
    monthlyBeforeFixedCostsUsd: usd(monthly(perJob)),
    monthlyOperatingResultBeforeTaxUsd: usd(perJob === null || count === null || fixed === null
      ? null : perJob * count - fixed),
    breakEvenPaidJobs: perJob !== null && perJob > ZERO && fixed !== null
      ? String((fixed + perJob - ONE) / perJob) : null,
    breakEvenStatus: perJob === null || fixed === null ? "unknown_costs"
      : perJob <= ZERO ? "no_positive_contribution" : "calculated",
  });
  const missingInputs = [
    ...(count === null ? ["paidJobsPerMonth"] : []),
    ...(spend === null ? ["creatorSpendUsdPerJob"] : []),
    ...Object.entries(input.variableCostUsdPerJob).filter(([, amount]) => amount === null)
      .map(([name]) => `variableCostUsdPerJob.${name}`),
    ...(["fixedMonthlyUsd", "acquisitionMonthlyUsd"] as const).filter(name => input[name] === null),
  ];
  return {
    schema: "keryx-business-scenario-v1",
    label: "planning-scenario-not-realized-profit",
    basis: input.basis,
    missingInputs,
    monthly: {
      packageReceiptsUsd: usd(monthly(fee + budget)),
      serviceFeeComponentUsd: usd(monthly(fee)),
      creatorBudgetCollectedUsd: usd(monthly(budget)),
      creatorPaymentsUsd: usd(monthly(spend)),
      unusedCreatorBudgetUsd: usd(monthly(spend === null ? null : budget - spend)),
      variableOperatingCostsUsd: usd(monthly(variable)),
      fixedAndAcquisitionCostsUsd: usd(fixed),
    },
    serviceFeeOnly: contribution(variable === null ? null : fee - variable),
    fixedPriceRetentionScenario: contribution(variable === null || spend === null ? null : fee + budget - spend - variable),
    notes: [
      "All inputs are USD estimates; no live USDC exchange-rate conversion is performed.",
      "Service-fee-only contribution excludes unused creator budget. The retention scenario shows the separate effect of retaining it under a fixed-price policy.",
      "Creator payments are subtracted once. Pending and unmeasured costs must be supplied conservatively or left unknown, never assumed zero.",
      "Results exclude taxes and financing costs. Include all relevant operating, acquisition and loss costs in the inputs. This is not accounting recognition or a price quote.",
    ],
  };
}
