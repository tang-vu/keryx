/**
 * Treasury-threshold decision tests. Locks which balances trip an alert and that a healthy
 * treasury stays silent.
 */

import { describe, it, expect } from "vitest";
import { treasuryAlerts } from "./treasury-thresholds";

const T = { minUsdc: 2, minGas: 0.02 };

describe("treasuryAlerts", () => {
  it("is silent when both balances are at or above their thresholds", () => {
    expect(treasuryAlerts({ usdc: 2, gas: 0.02 }, T)).toEqual([]);
    expect(treasuryAlerts({ usdc: 10, gas: 1 }, T)).toEqual([]);
  });

  it("alerts on a low USDC reserve", () => {
    const a = treasuryAlerts({ usdc: 1.5, gas: 1 }, T);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/USDC reserve low/);
  });

  it("alerts on low gas", () => {
    const a = treasuryAlerts({ usdc: 10, gas: 0.01 }, T);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/gas low/);
  });

  it("reports both when both are depleted", () => {
    expect(treasuryAlerts({ usdc: 0, gas: 0 }, T)).toHaveLength(2);
  });
});
