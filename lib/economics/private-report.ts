import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { TestnetEconomicsSnapshot } from "./testnet-economics";
// Reuse the filesystem-only Linux operator boundary; this opens no relay or signer.
import { inspectWithdrawalRelayDirectory } from "../gateway/withdrawal-relay-files";

export function privateEconomicsReport(s: TestnetEconomicsSnapshot) {
  return {
    schema: "keryx-private-economics-v1", visibility: "operator-only", generatedAt: s.generatedAt,
    scope: "Legacy testnet query_runs, payment_events and a2a_orders aggregates. Not complete business accounting or an atomic cross-table snapshot.",
    accounting: { status: "unreconciled", providerInvoiceUsd: null, fixedOperatingCostUsd: null, realizedProfitUsd: null },
    coverage: { sampledRuns: s.sampledRuns, pricedRuns: s.pricedRuns, unpricedRuns: s.unpricedRuns,
      providerCalls: s.providerCalls, inputTokens: s.inputTokens, cachedInputTokens: s.cachedInputTokens,
      outputTokens: s.outputTokens, unpricedModels: s.unpricedModels },
    estimates: { llmCostUsd: s.estimatedLlmCostUsd, shadowServiceFeesUsdc: s.shadowServiceFeesUsdc,
      shadowGrossMarginUsd: s.shadowGrossMarginUsd, policy: { id: s.policy.id, capturedAt: s.policy.capturedAt,
        pricingSource: s.policy.pricingSource, infraAllowanceUsdPerRun: s.policy.infraAllowanceUsdPerRun,
        serviceFeeUsdc: { quick: s.policy.serviceFeeUsdc.quick, deep: s.policy.serviceFeeUsdc.deep } } },
    testnetLedger: { settledInboundUsdc: s.settledInboundRevenueUsdc, settledA2aServiceFeesUsdc: s.settledA2aV2ServiceFeesUsdc,
      prepaidCreatorCapsUsdc: s.prepaidA2aCreatorCapsUsdc, prepaidCreatorSpendUsdc: s.prepaidA2aCreatorSpendUsdc,
      completedUnusedReserveUsdc: s.completedA2aUnusedReserveUsdc, browserCreatorSpendUsdc: s.browserCreatorSpendUsdc,
      treasuryCreatorSubsidyUsdc: s.treasuryCreatorSubsidyUsdc, unknownFundingCreatorSpendUsdc: s.unknownFundingCreatorSpendUsdc,
      pendingCreatorSpendUsdc: s.pendingCreatorSpendUsdc },
    limitations: "Partial usage estimates and testnet ledger observations are not invoices, mainnet revenue, or realized profit. Missing costs remain unknown.",
  };
}

/** Explicit new directory under an existing owner-only Linux parent. No stdout,
 * overwrites or cleanup of retained partial output on failure. */
export async function writePrivateEconomicsReport(directory: string, load: () => Promise<TestnetEconomicsSnapshot>) {
  try {
    if (!isAbsolute(directory) || resolve(directory) !== directory) throw new Error();
    const parent = await inspectWithdrawalRelayDirectory(dirname(directory));
    await mkdir(directory, { mode: 0o700 });
    await inspectWithdrawalRelayDirectory(directory);
    const bytes = Buffer.from(JSON.stringify(privateEconomicsReport(await load()), null, 2));
    if (bytes.length > 65_536) throw new Error();
    const file = await open(join(directory, "economics.json"), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(bytes); await file.sync();
      const stat = await file.stat(), saved = Buffer.alloc(bytes.length);
      const read = await file.read(saved, 0, saved.length, 0);
      if (!stat.isFile() || stat.uid !== process.getuid!() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0
        || stat.size !== bytes.length || read.bytesRead !== bytes.length || !saved.equals(bytes)) throw new Error();
    } finally { await file.close(); }
    await inspectWithdrawalRelayDirectory(directory);
    for (const path of [directory, parent]) {
      const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await handle.sync(); } finally { await handle.close(); }
    }
    return { state: "saved" as const };
  } catch { throw new Error("Private economics export unavailable. Retain existing output; use a new directory under a protected Linux parent. No private details emitted."); }
}
