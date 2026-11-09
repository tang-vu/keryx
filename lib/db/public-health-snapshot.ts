import type { A2aOperationsSnapshot } from "../a2a/operations";
import type { DashboardMetrics } from "../types";

/** Fixed public-health inputs, before the route's existing privacy/projection rules. */
export interface PublicHealthSnapshot {
  metrics: DashboardMetrics;
  jobs: A2aOperationsSnapshot;
  syncState: ReadonlyMap<string, string | null>;
}

const HEALTH_SYNC_KEYS = Object.freeze([
  "lastSyncedBlock", "registryParity", "dispatchHealth", "settlementParity",
  "pendingPaymentReconciliation", "a2aWorker",
]);

export function publicHealthSyncKeys(includeRegistry: boolean): readonly string[] {
  return includeRegistry ? HEALTH_SYNC_KEYS : HEALTH_SYNC_KEYS.slice(2);
}
