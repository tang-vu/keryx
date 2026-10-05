import { describe, expect, it } from "vitest";
import { monitoringObservations, MONITORING_CHECKS, type MonitoringCheckName } from "./monitoring-observations";

const now = Date.parse("2026-10-05T02:00:00Z");
const empty = { registry: null, dispatches: null, settlement: null, reconciliation: null };
describe("recorded monitoring observations", () => {
  it("exposes every missing check rather than presenting absent summaries as passes", () => {
    const result = monitoringObservations(empty, now);
    expect(result.state).toBe("incomplete");
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every(check => check.state === "unavailable" && check.checkedAt === null)).toBe(true);
  });
  it("uses distinct hourly and reconciliation freshness bounds with exact boundaries", () => {
    const summaries = Object.fromEntries(MONITORING_CHECKS.map(check => [check.name,
      { checkedAt: new Date(now - check.maxAgeSeconds * 1_000).toISOString() }])) as Record<MonitoringCheckName, unknown>;
    expect(monitoringObservations(summaries, now).state).toBe("recent");
    const expired = monitoringObservations(summaries, now + 1);
    expect(expired.state).toBe("incomplete");
    expect(expired.checks.every(check => check.state === "stale" && check.checkedAt !== null)).toBe(true);
  });
  it.each([{}, [], { checkedAt: 123 }, { checkedAt: "invalid" },
    { checkedAt: new Date(now + 1).toISOString() }])("refuses malformed or future timestamps: %j", value => {
    expect(monitoringObservations({ ...empty, registry: value }, now).checks[0].state).toBe("unavailable");
  });
  it("retains a recent failing observation without certifying its outcome or changing its data", () => {
    const registry = Object.freeze({ checkedAt: new Date(now).toISOString(), issueCount: 3 });
    const result = monitoringObservations({ ...empty, registry }, now);
    expect(result.state).toBe("incomplete");
    expect(result.checks[0].state).toBe("recent");
    expect(registry.issueCount).toBe(3);
    expect(result.checks[0]).not.toHaveProperty("passed");
  });
});
