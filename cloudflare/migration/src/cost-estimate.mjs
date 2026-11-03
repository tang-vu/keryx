/** Published rates checked 2026-11-03. Estimates, not Cloudflare billing limits.
 * https://developers.cloudflare.com/workers/platform/pricing/
 * https://developers.cloudflare.com/containers/platform/pricing/
 */
export function estimateContainerCost({ hours, memoryGiB, diskGB, activeVcpu, included = false }) {
  for (const value of [hours, memoryGiB, diskGB, activeVcpu]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid usage estimate");
  }
  if (hours > 744 || activeVcpu > 4 || memoryGiB > 12 || diskGB > 20) throw new Error("Usage exceeds estimate scope");
  const memoryGiBHours = hours * memoryGiB;
  const cpuMinutes = hours * 60 * activeVcpu;
  const diskGBHours = hours * diskGB;
  return {
    memoryGiBHours, cpuMinutes, diskGBHours,
    memoryUsd: Math.max(0, memoryGiBHours - (included ? 25 : 0)) * 3600 * 0.0000025,
    cpuUsd: Math.max(0, cpuMinutes - (included ? 375 : 0)) * 60 * 0.000020,
    diskUsd: Math.max(0, diskGBHours - (included ? 200 : 0)) * 3600 * 0.00000007,
  };
}

export function estimateMigrationMonth() {
  // Conservative: do not spend the account's shared included Container allowance twice.
  // One basic instance, at most two active hours/day over thirty days, full 1/4 CPU.
  const container = estimateContainerCost({ hours: 60, memoryGiB: 1, diskGB: 4, activeVcpu: 0.25 });
  return {
    format: "keryx-cloudflare-estimate-v1", currency: "USD", workersBaseMonthly: 5,
    container, baseAndContainerUsd: 5 + container.memoryUsd + container.cpuUsd + container.diskUsd,
    planningRangeUsd: [5, 10],
    assumptions: { containerInstances: 1, activeContainerHours: 60, workerRequests: 30_000,
      workerCpuMs: 300_000, storedDataGB: 1 },
    excludes: ["AI/search provider charges", "tax", "existing account usage", "usage above assumptions"],
    hardSpendingCap: false,
  };
}
