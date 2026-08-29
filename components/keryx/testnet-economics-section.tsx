export interface TestnetEconomicsHealth {
  sampledRuns: number;
  pricedRuns: number;
  unpricedRuns: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedLlmCostUsd: number;
  shadowServiceFeesUsdc: number;
  shadowGrossMarginUsd: number;
  settledInboundRevenueUsdc: number;
  settledA2aV2ServiceFeesUsdc: number;
  prepaidA2aCreatorCapsUsdc: number;
  prepaidA2aCreatorSpendUsdc: number;
  completedA2aUnusedReserveUsdc: number;
  browserCreatorSpendUsdc: number;
  treasuryCreatorSubsidyUsdc: number;
  unknownFundingCreatorSpendUsdc: number;
  pendingCreatorSpendUsdc: number;
  unpricedModels: string[];
  policy: {
    id: string;
    infraAllowanceUsdPerRun: number;
    serviceFeeUsdc: { quick: number; deep: number };
  };
}

function money(value: number): string {
  return `$${value.toFixed(6)}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-paper-2 px-3 py-2.5">
      <dt className="text-[9px] uppercase tracking-[0.13em] text-ink-3">{label}</dt>
      <dd className="mt-1 tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export function TestnetEconomicsSection({ economics }: { economics: TestnetEconomicsHealth }) {
  return (
    <section className="mt-8 border-t border-line pt-5 font-mono text-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
          Testnet economics observatory
        </h2>
        <span className="border border-seal/40 bg-seal/5 px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-seal">
          simulation · not revenue
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Settled A2A gross" value={money(economics.settledInboundRevenueUsdc)} />
        <Metric label="A2A v2 service fees" value={money(economics.settledA2aV2ServiceFeesUsdc)} />
        <Metric label="A2A prepaid creators" value={money(economics.prepaidA2aCreatorSpendUsdc)} />
        <Metric label="Treasury creator subsidy" value={money(economics.treasuryCreatorSubsidyUsdc)} />
        <Metric label="Browser-funded creators" value={money(economics.browserCreatorSpendUsdc)} />
        <Metric label="Estimated LLM cost" value={money(economics.estimatedLlmCostUsd)} />
        <Metric label="Shadow service fees" value={money(economics.shadowServiceFeesUsdc)} />
        <Metric label="Shadow gross margin" value={money(economics.shadowGrossMarginUsd)} />
        <Metric label="Completed unused reserve" value={money(economics.completedA2aUnusedReserveUsdc)} />
      </dl>

      <p className="mt-3 text-[10px] leading-relaxed tracking-wide text-faint">
        {economics.sampledRuns} measured run{economics.sampledRuns === 1 ? "" : "s"}; {" "}
        {economics.pricedRuns} fully priced, {economics.unpricedRuns} unpriced. Shadow fees are
        hypothetical (${economics.policy.serviceFeeUsdc.quick.toFixed(2)} Quick / $
        {economics.policy.serviceFeeUsdc.deep.toFixed(2)} Deep) and exclude creator pass-through.
        Historical funding remains unknown instead of being guessed
        {economics.unknownFundingCreatorSpendUsdc > 0
          ? ` (${money(economics.unknownFundingCreatorSpendUsdc)} settled)`
          : ""}
        .
      </p>
      {economics.unpricedModels.length > 0 && (
        <p className="mt-2 text-[10px] text-seal">
          Awaiting verified rates: {economics.unpricedModels.join(", ")}.
        </p>
      )}
      {economics.pendingCreatorSpendUsdc > 0 && (
        <p className="mt-2 text-[10px] text-seal">
          Pending creator settlement: {money(economics.pendingCreatorSpendUsdc)} — excluded from
          settled totals.
        </p>
      )}
    </section>
  );
}
