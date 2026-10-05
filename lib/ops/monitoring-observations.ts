/** Summary freshness is read-only telemetry, never payment or scheduler authority. */
export const MONITORING_CHECKS = [
  { name: "registry", label: "Registry parity", maxAgeSeconds: 7_200 },
  { name: "dispatches", label: "Research outcomes", maxAgeSeconds: 7_200 },
  { name: "settlement", label: "Settlement parity", maxAgeSeconds: 7_200 },
  { name: "reconciliation", label: "Payment reconciliation", maxAgeSeconds: 1_800 },
] as const;

export type MonitoringCheckName = typeof MONITORING_CHECKS[number]["name"];
export interface MonitoringObservation {
  name: MonitoringCheckName;
  label: string;
  state: "recent" | "stale" | "unavailable";
  checkedAt: string | null;
  maxAgeSeconds: number;
}
export interface MonitoringObservations {
  state: "recent" | "incomplete";
  checks: MonitoringObservation[];
}

/** A recent timestamp only dates a recorded check; it does not establish a pass,
 * active scheduling, live payment acceptance, or independent settlement proof. */
export function monitoringObservations(
  summaries: Record<MonitoringCheckName, unknown>, now = Date.now(),
): MonitoringObservations {
  const checks = MONITORING_CHECKS.map(({ name, label, maxAgeSeconds }): MonitoringObservation => {
    const summary = summaries[name];
    const value = summary && typeof summary === "object" && !Array.isArray(summary)
      ? (summary as { checkedAt?: unknown }).checkedAt : undefined;
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(now) || !Number.isFinite(timestamp) || timestamp > now) {
      return { name, label, maxAgeSeconds, state: "unavailable", checkedAt: null };
    }
    return { name, label, maxAgeSeconds, checkedAt: value as string,
      state: now - timestamp <= maxAgeSeconds * 1_000 ? "recent" : "stale" };
  });
  return { state: checks.every(check => check.state === "recent") ? "recent" : "incomplete", checks };
}
