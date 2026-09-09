"use client";

import { useRef, useState } from "react";
import { businessScenarioSchema, calculateBusinessScenario } from "@/lib/economics/business-scenario";
import template from "@/docs/business-scenario-template.json";

const fields = [
  ["paidJobsPerMonth", "Paid jobs per month", "Whole jobs; leave blank when demand is unknown."],
  ["serviceFeeUsdPerJob", "Service fee per job", "The service-fee portion of the modeled package price."],
  ["creatorBudgetUsdPerJob", "Creator budget per job", "Budget collected for source access and citation rewards."],
  ["creatorSpendUsdPerJob", "Creator spend per job", "Include creator obligations; pending spend is not unused reserve."],
  ["llm", "AI model cost per job", "Include retries and unsuccessful calls."],
  ["infrastructure", "Variable infrastructure per job", "Exclude costs entered as fixed monthly expenses."],
  ["paymentAndGas", "Payment and gas per job", "Expected transaction and payment processing costs."],
  ["support", "Support cost per job", "Expected variable support effort."],
  ["refundAndLoss", "Refunds and losses per job", "Expected losses, refunds and service recovery costs."],
  ["fixedMonthlyUsd", "Fixed operating costs per month", "Hosting, tools and other fixed expenses."],
  ["acquisitionMonthlyUsd", "Customer acquisition per month", "Marketing and acquisition costs, without double counting."],
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
const money = (value: string | null) => value === null ? "Unknown" : `$${value}`;
const button = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";

export function BusinessCalculator() {
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
      <h2 id="assumptions-title" className="font-display text-3xl">Your assumptions</h2>
      <p className="mt-3 font-serif text-ink-2">Enter USD estimates. Leave unknown values blank; enter 0 only when a cost is known to be zero. No live exchange-rate conversion is performed.</p>
      <label className="mt-5 grid max-w-sm gap-2 font-mono text-xs">Scenario basis<select value={form.basis} onChange={event => edit("basis", event.target.value)} className="border border-line bg-paper-2 p-3">
        <option value="illustrative">Illustrative example</option><option value="operator-estimate">My operating estimates</option>
      </select></label>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([key, label, hint]) => <label key={key} className="grid content-start gap-2 font-mono text-xs">{label}
          <input aria-label={label} value={form[key]} onChange={event => edit(key, event.target.value)} inputMode={key === "paidJobsPerMonth" ? "numeric" : "decimal"} autoComplete="off" placeholder={key === "serviceFeeUsdPerJob" || key === "creatorBudgetUsdPerJob" ? "Required" : "Unknown"} className="min-w-0 w-full border border-line bg-paper-2 p-3" />
          <span className="font-serif text-sm text-ink-3">{hint}</span>
        </label>)}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={button} disabled={!result} onClick={() => download("inputs")}>Export inputs</button>
        <button type="button" className={button} disabled={!result} onClick={() => download("report")}>Export scenario report</button>
        <label className={`${button} cursor-pointer`}>Import inputs<input aria-label="Import scenario inputs" type="file" accept=".json,application/json" className="sr-only" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          const version = ++revision.current;
          try {
            if (file.size > 8192) throw new Error("Oversized file");
            const parsed = businessScenarioSchema.parse(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
            if (version !== revision.current) return;
            setForm(toForm(parsed)); setNotice("Scenario inputs imported locally.");
          } catch { if (version === revision.current) setNotice("Could not import inputs. Use a Keryx inputs JSON file under 8 KB; your existing values were kept."); }
        }} /></label>
        <button type="button" className={button} onClick={() => { revision.current++; setForm(initial()); setNotice("Reset to illustrative fees with unknown costs and demand."); }}>Reset assumptions</button>
      </div>
      <p className="mt-3 font-serif text-sm text-ink-3">Calculations and imported files stay in this page. Export inputs to keep them; reloading clears your edits. A report includes your inputs, so review it before sharing.</p>
      {notice && <p role="status" className="mt-3 font-serif text-sm">{notice}</p>}
    </section>
    {!result ? <p role="alert" className="border border-seal p-5 font-serif">Enter nonnegative amounts with up to six decimal places and whole monthly job counts. Service fee and creator budget are required; creator spend cannot exceed its budget. Results are hidden until the inputs are valid.</p> : <>
      <section aria-labelledby="results-title" className="space-y-4">
        <h2 id="results-title" className="font-display text-3xl">Modeled operating results</h2>
        <p className="font-serif text-ink-2">{form.basis === "illustrative" ? "Illustrative scenario" : "Your operating estimates"} · {result.missingInputs.length} unknown inputs. These are two alternative views; do not add them together.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {([
            ["Service fee only", result.serviceFeeOnly, "Contribution = service fee − variable operating costs"],
            ["Fixed-price reserve retention", result.fixedPriceRetentionScenario, "Contribution = service fee + creator budget − creator spend − variable operating costs"],
          ] as const).map(([title, value, formula]) => <article key={title} className="min-w-0 border border-line bg-paper p-5" aria-label={title}>
            <h3 className="font-display text-2xl">{title}</h3><p className="mt-3 font-serif text-sm text-ink-3">{formula}</p>
            <dl className="mt-5 space-y-4 font-serif">
              <div><dt>Contribution per job</dt><dd className="break-all font-mono text-lg">{money(value.perJobUsd)}</dd></div>
              <div><dt>Monthly operating result before tax</dt><dd className="break-all font-mono text-xl">{money(value.monthlyOperatingResultBeforeTaxUsd)}</dd></div>
              <div><dt>Break-even paid jobs per month</dt><dd className="font-mono">{value.breakEvenPaidJobs ?? (value.breakEvenStatus === "no_positive_contribution" ? "No positive contribution" : "Unknown costs")}</dd></div>
            </dl>
          </article>)}
        </div>
        <p className="font-serif text-sm text-ink-3">Monthly result = paid jobs × contribution − fixed and acquisition costs. Break-even rounds up to whole jobs and requires positive contribution. Taxes and financing are excluded.</p>
        <dl className="grid gap-4 border border-line p-5 font-serif sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["Monthly package receipts", result.monthly.packageReceiptsUsd], ["Service-fee component", result.monthly.serviceFeeComponentUsd],
            ["Creator payments", result.monthly.creatorPaymentsUsd], ["Unused creator budget", result.monthly.unusedCreatorBudgetUsd],
            ["Variable operating costs", result.monthly.variableOperatingCostsUsd], ["Fixed and acquisition costs", result.monthly.fixedAndAcquisitionCostsUsd],
          ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt>{label}</dt><dd className="break-all font-mono">{money(value)}</dd></div>)}
        </dl>
      </section>
    </>}
  </div>;
}
