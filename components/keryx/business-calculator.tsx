"use client";

import { useRef, useState } from "react";
import { businessScenarioSchema, calculateBusinessScenario } from "@/lib/economics/business-scenario";
import template from "@/docs/business-scenario-template.json";
import { createMessages } from "@/lib/i18n/messages";

import { useUiMessages, useUiRichMessages } from "@/lib/i18n/ui-copy";



const message = createMessages("en");


const fields = [
  ["paidJobsPerMonth", message("businessCalculator.paidJobsPerMonth"), message("businessCalculator.wholeJobsLeaveBlankWhenDemandIsUnknown")],
  ["serviceFeeUsdPerJob", message("businessCalculator.serviceFeePerJob"), message("businessCalculator.theServiceFeePortionOfTheModeledPackage")],
  ["creatorBudgetUsdPerJob", message("businessCalculator.creatorBudgetPerJob"), message("businessCalculator.budgetCollectedForSourceAccessAndCitationRewards")],
  ["creatorSpendUsdPerJob", message("businessCalculator.creatorSpendPerJob"), message("businessCalculator.includeCreatorObligationsPendingSpendIsNotUnused")],
  ["llm", message("businessCalculator.aiModelCostPerJob"), message("businessCalculator.includeRetriesAndUnsuccessfulCalls")],
  ["infrastructure", message("businessCalculator.variableInfrastructurePerJob"), message("businessCalculator.excludeCostsEnteredAsFixedMonthlyExpenses")],
  ["paymentAndGas", message("businessCalculator.paymentAndGasPerJob"), message("businessCalculator.expectedTransactionAndPaymentProcessingCosts")],
  ["support", message("businessCalculator.supportCostPerJob"), message("businessCalculator.expectedVariableSupportEffort")],
  ["refundAndLoss", message("businessCalculator.refundsAndLossesPerJob"), message("businessCalculator.expectedLossesRefundsAndServiceRecoveryCosts")],
  ["fixedMonthlyUsd", message("businessCalculator.fixedOperatingCostsPerMonth"), message("businessCalculator.hostingToolsAndOtherFixedExpenses")],
  ["acquisitionMonthlyUsd", message("businessCalculator.customerAcquisitionPerMonth"), message("businessCalculator.marketingAndAcquisitionCostsWithoutDoubleCounting")],
] as const;
type Field = typeof fields[number][0];
type Form = Record<Field, string> & { basis: "illustrative" | "operator-estimate" };
type Scenario = ReturnType<typeof businessScenarioSchema.parse>;
function toForm(input: Scenario): Form {
  const result = { basis: input.basis } as Form;
  for (const [key] of fields) result[key] = String(key in input ? input[key as keyof Scenario] ?? "" : input.variableCostUsdPerJob[key as keyof Scenario["variableCostUsdPerJob"]] ?? "");
  return result;
}
const initial = () => toForm(businessScenarioSchema.parse(template));
function scenario(form: Form): Scenario {
  const optional = (key: Field) => form[key].trim() || null;
  return businessScenarioSchema.parse({ basis: form.basis,
    paidJobsPerMonth: !form.paidJobsPerMonth.trim() ? null : /^\d+$/.test(form.paidJobsPerMonth.trim()) ? Number(form.paidJobsPerMonth) : NaN,
    serviceFeeUsdPerJob: form.serviceFeeUsdPerJob.trim(), creatorBudgetUsdPerJob: form.creatorBudgetUsdPerJob.trim(),
    creatorSpendUsdPerJob: optional("creatorSpendUsdPerJob"),
    variableCostUsdPerJob: { llm: optional("llm"), infrastructure: optional("infrastructure"), paymentAndGas: optional("paymentAndGas"), support: optional("support"), refundAndLoss: optional("refundAndLoss") },
    fixedMonthlyUsd: optional("fixedMonthlyUsd"), acquisitionMonthlyUsd: optional("acquisitionMonthlyUsd"),
  });
}
const money = (value: string | null) => value === null ? message("businessCalculator.unknown") : `$${value}`;
const button = message("businessCalculator.borderBorderInkPx4Py2Font");

export function BusinessCalculator() {
  const message = useUiMessages();
  const richMessage = useUiRichMessages();
  const [form, setForm] = useState<Form>(initial);
  const [notice, setNotice] = useState("");
  const revision = useRef(0);
  let input: Scenario | null = null;
  let result: ReturnType<typeof calculateBusinessScenario> | null = null;
  try { input = scenario(form); result = calculateBusinessScenario(input); } catch { /* Invalid edits hide all old results. */ }

  function edit(key: keyof Form, value: string) {
    revision.current++; setNotice(""); setForm(previous => ({ ...previous, [key]: value }));
  }
  function download(kind: "inputs" | "report") {
    if (!input || !result) return;
    const blob = new Blob([JSON.stringify(kind === "inputs" ? input : { inputs: input, report: result }, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `keryx-business-${kind}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-8">
    <section className="border border-line bg-paper p-5 sm:p-8" aria-labelledby="assumptions-title">
      <h2 id="assumptions-title" className="font-display text-3xl">{message("businessCalculator.yourAssumptions")}</h2>
      <p className="mt-3 font-serif text-ink-2">{message("businessCalculator.enterUSDEstimatesLeaveUnknownValuesBlankEnter")}</p>
      <label className="mt-5 grid max-w-sm gap-2 font-mono text-xs">{richMessage("businessCalculator.scenarioBasisContent", { content: <select value={form.basis} onChange={event => edit("basis", event.target.value)} className="border border-line bg-paper-2 p-3">
        <option value="illustrative">{message("businessCalculator.illustrativeExample")}</option><option value="operator-estimate">{message("businessCalculator.myOperatingEstimates")}</option>
      </select> })}</label>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([key, label, hint]) => <label key={key} className="grid content-start gap-2 font-mono text-xs">{label}
          <input aria-label={label} value={form[key]} onChange={event => edit(key, event.target.value)} inputMode={key === "paidJobsPerMonth" ? "numeric" : "decimal"} autoComplete="off" placeholder={key === "serviceFeeUsdPerJob" || key === "creatorBudgetUsdPerJob" ? message("businessCalculator.required") : message("businessCalculator.unknown")} className="min-w-0 w-full border border-line bg-paper-2 p-3" />
          <span className="font-serif text-sm text-ink-3">{hint}</span>
        </label>)}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={button} disabled={!result} onClick={() => download("inputs")}>{message("businessCalculator.exportInputs")}</button>
        <button type="button" className={button} disabled={!result} onClick={() => download("report")}>{message("businessCalculator.exportScenarioReport")}</button>
        <label className={`${button} cursor-pointer`}>{richMessage("businessCalculator.importInputsContent", { content: <input aria-label={message("businessCalculator.importScenarioInputs")} type="file" accept=".json,application/json" className="sr-only" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          const version = ++revision.current;
          try {
            if (file.size > 8192) throw new Error("Oversized file");
            const parsed = businessScenarioSchema.parse(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
            if (version !== revision.current) return;
            setForm(toForm(parsed)); setNotice(message("businessCalculator.scenarioInputsImportedLocally"));
          } catch { if (version === revision.current) setNotice(message("businessCalculator.couldNotImportInputsUseAKeryxInputs")); }
        }} /> })}</label>
        <button type="button" className={button} onClick={() => { revision.current++; setForm(initial()); setNotice(message("businessCalculator.resetToIllustrativeFeesWithUnknownCostsAnd")); }}>{message("businessCalculator.resetAssumptions")}</button>
      </div>
      <p className="mt-3 font-serif text-sm text-ink-3">{message("businessCalculator.calculationsAndImportedFilesStayInThisPage")}</p>
      {notice && <p role="status" className="mt-3 font-serif text-sm">{notice}</p>}
    </section>
    {!result ? <p role="alert" className="border border-seal p-5 font-serif">{message("businessCalculator.enterNonnegativeAmountsWithUpToSixDecimal")}</p> : <>
      <section aria-labelledby="results-title" className="space-y-4">
        <h2 id="results-title" className="font-display text-3xl">{message("businessCalculator.modeledOperatingResults")}</h2>
        <p className="font-serif text-ink-2">{richMessage(result.missingInputs.length === 1 ? "businessCalculator.unknownInputs.one" : "businessCalculator.unknownInputs.other", { basis: form.basis === "illustrative" ? message("businessCalculator.illustrativeScenario") : message("businessCalculator.yourOperatingEstimates"), count: result.missingInputs.length })}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {([
            [message("businessCalculator.serviceFeeOnly"), result.serviceFeeOnly, message("businessCalculator.contributionServiceFeeVariableOperatingCosts")],
            [message("businessCalculator.fixedPriceReserveRetention"), result.fixedPriceRetentionScenario, message("businessCalculator.contributionServiceFeeCreatorBudgetCreatorSpendVariable")],
          ] as const).map(([title, value, formula]) => <article key={title} className="min-w-0 border border-line bg-paper p-5" aria-label={title}>
            <h3 className="font-display text-2xl">{title}</h3><p className="mt-3 font-serif text-sm text-ink-3">{formula}</p>
            <dl className="mt-5 space-y-4 font-serif">
              <div><dt>{message("businessCalculator.contributionPerJob")}</dt><dd className="break-all font-mono text-lg">{money(value.perJobUsd)}</dd></div>
              <div><dt>{message("businessCalculator.monthlyOperatingResultBeforeTax")}</dt><dd className="break-all font-mono text-xl">{money(value.monthlyOperatingResultBeforeTaxUsd)}</dd></div>
              <div><dt>{message("businessCalculator.breakEvenPaidJobsPerMonth")}</dt><dd className="font-mono">{value.breakEvenPaidJobs ?? (value.breakEvenStatus === "no_positive_contribution" ? message("businessCalculator.noPositiveContribution") : message("businessCalculator.unknownCosts"))}</dd></div>
            </dl>
          </article>)}
        </div>
        <p className="font-serif text-sm text-ink-3">{message("businessCalculator.monthlyResultPaidJobsContributionFixedAndAcquisition")}</p>
        <dl className="grid gap-4 border border-line p-5 font-serif sm:grid-cols-2 lg:grid-cols-3">
          {([
            [message("businessCalculator.monthlyPackageReceipts"), result.monthly.packageReceiptsUsd], [message("businessCalculator.serviceFeeComponent"), result.monthly.serviceFeeComponentUsd],
            [message("businessCalculator.creatorPayments"), result.monthly.creatorPaymentsUsd], [message("businessCalculator.unusedCreatorBudget"), result.monthly.unusedCreatorBudgetUsd],
            [message("businessCalculator.variableOperatingCosts"), result.monthly.variableOperatingCostsUsd], [message("businessCalculator.fixedAndAcquisitionCosts"), result.monthly.fixedAndAcquisitionCostsUsd],
          ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt>{label}</dt><dd className="break-all font-mono">{money(value)}</dd></div>)}
        </dl>
      </section>
    </>}
  </div>;
}
