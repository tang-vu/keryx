import { describe, expect, it } from "vitest";
import { calculateBusinessScenario } from "./business-scenario";

const example = () => ({
  basis: "illustrative", paidJobsPerMonth: 20,
  serviceFeeUsdPerJob: "10", creatorBudgetUsdPerJob: "5", creatorSpendUsdPerJob: "3",
  variableCostUsdPerJob: { llm: "2", infrastructure: "1", paymentAndGas: "0", support: "1", refundAndLoss: "0" },
  fixedMonthlyUsd: "40", acquisitionMonthlyUsd: "20",
});

describe("business scenario arithmetic", () => {
  it("separates creator money from service fees and subtracts creator payments only once", () => {
    const result = calculateBusinessScenario(example());
    expect(result.monthly.packageReceiptsUsd).toBe("300.000000");
    expect(result.monthly.serviceFeeComponentUsd).toBe("200.000000");
    expect(result.monthly.creatorPaymentsUsd).toBe("60.000000");
    expect(result.serviceFeeOnly).toMatchObject({ perJobUsd: "6.000000", monthlyOperatingResultBeforeTaxUsd: "60.000000", breakEvenPaidJobs: "10" });
    expect(result.fixedPriceRetentionScenario).toMatchObject({ perJobUsd: "8.000000", monthlyOperatingResultBeforeTaxUsd: "100.000000", breakEvenPaidJobs: "8" });
  });

  it("does not turn an unknown cost into profit", () => {
    const input = { ...example(), variableCostUsdPerJob: { ...example().variableCostUsdPerJob, llm: null } };
    const result = calculateBusinessScenario(input);
    expect(result.serviceFeeOnly.monthlyOperatingResultBeforeTaxUsd).toBeNull();
    expect(result.fixedPriceRetentionScenario.breakEvenPaidJobs).toBeNull();
    expect(result.missingInputs).toContain("variableCostUsdPerJob.llm");
    expect(result.monthly.packageReceiptsUsd).toBe("300.000000");
  });

  it("keeps unknown volume and fixed costs distinct from known contribution", () => {
    const result = calculateBusinessScenario({ ...example(), paidJobsPerMonth: null, fixedMonthlyUsd: null });
    expect(result.serviceFeeOnly.perJobUsd).toBe("6.000000");
    expect(result.serviceFeeOnly.monthlyOperatingResultBeforeTaxUsd).toBeNull();
    expect(result.monthly.packageReceiptsUsd).toBeNull();
    expect(result.serviceFeeOnly.breakEvenPaidJobs).toBeNull();
  });

  it("can model service-fee contribution without assuming unknown unused reserve is profit", () => {
    const result = calculateBusinessScenario({ ...example(), creatorSpendUsdPerJob: null });
    expect(result.serviceFeeOnly.perJobUsd).toBe("6.000000");
    expect(result.monthly.unusedCreatorBudgetUsd).toBeNull();
    expect(result.fixedPriceRetentionScenario.perJobUsd).toBeNull();
  });

  it("keeps exact micro-dollar arithmetic and rounds break-even volume upward", () => {
    const result = calculateBusinessScenario({ ...example(), paidJobsPerMonth: 1_000_000_000,
      serviceFeeUsdPerJob: "4.000003", fixedMonthlyUsd: "0.000007", acquisitionMonthlyUsd: "0" });
    expect(result.serviceFeeOnly.perJobUsd).toBe("0.000003");
    expect(result.serviceFeeOnly.monthlyOperatingResultBeforeTaxUsd).toBe("2999.999993");
    expect(result.serviceFeeOnly.breakEvenPaidJobs).toBe("3");
  });

  it.each(["0", "4"])("reports no positive contribution at service fee %s", fee => {
    const result = calculateBusinessScenario({ ...example(), serviceFeeUsdPerJob: fee });
    expect(result.serviceFeeOnly.breakEvenStatus).toBe("no_positive_contribution");
    expect(result.serviceFeeOnly.breakEvenPaidJobs).toBeNull();
  });

  it("reports fixed costs as a loss at zero volume", () => {
    const result = calculateBusinessScenario({ ...example(), paidJobsPerMonth: 0 });
    expect(result.serviceFeeOnly.monthlyOperatingResultBeforeTaxUsd).toBe("-60.000000");
  });

  it.each(["-1", "1e3", "0.0000001", "NaN"])("refuses invalid money %s", fee => {
    expect(() => calculateBusinessScenario({ ...example(), serviceFeeUsdPerJob: fee })).toThrow();
  });

  it("refuses out-of-cap creator spend, fractional volumes and missing cost fields", () => {
    expect(() => calculateBusinessScenario({ ...example(), creatorSpendUsdPerJob: "6" })).toThrow();
    expect(() => calculateBusinessScenario({ ...example(), paidJobsPerMonth: 0.5 })).toThrow();
    expect(() => calculateBusinessScenario({ ...example(), acquisitionMonthlyUsd: undefined })).toThrow();
  });
});
