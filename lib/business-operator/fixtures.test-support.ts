import type { OperatorInventory, OperatorLiquidity } from "./contracts";
export const NOW = Date.parse("2026-10-06T00:00:00.000Z");
export const inventory: OperatorInventory = { network: "eip155:5042", observedAt: new Date(NOW).toISOString(),
  queuedJobs: 1, processingJobs: 0, reviewRequiredJobs: 0, invalidJobs: 0,
  queuedCreatorMicroUsdc: "50000", unfinishedCreatorMicroUsdc: "0", prepaidCreatorMicroUsdc: "0",
  prepaidRequests: 0, largestCreatorMicroUsdc: "50000" };
export const liquidity: OperatorLiquidity = { availableMicroUsdc: "100000", retainedMicroUsdc: "20000",
  confirmedMicroUsdc: "10000", lifetimeCapMicroUsdc: "500000", queryCapMicroUsdc: "50000" };
