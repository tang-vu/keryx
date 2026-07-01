/**
 * Pure treasury-threshold rule for check-treasury.mts. Kept separate so the "which balance is too
 * low" decision is unit-tested without any RPC/wallet I/O.
 *
 * The funder (treasury) wallet backs settlement two ways: its ERC-20 USDC funds Gateway deposits,
 * and its native USDC funds the gas for those top-up txs. If either runs low, top-ups fail and
 * settlements stop — so both are watched, and each produces its own actionable alert line.
 */

export interface TreasuryStatus {
  /** Funder ERC-20 USDC reserve (6-decimal USDC, as a float). Funds Gateway deposits. */
  usdc: number;
  /** Funder native USDC balance (18-decimal gas token, as a float). Funds top-up tx gas. */
  gas: number;
}

export interface TreasuryThresholds {
  minUsdc: number;
  minGas: number;
}

/** Return one alert line per treasury balance below its threshold. Empty = healthy. */
export function treasuryAlerts(s: TreasuryStatus, t: TreasuryThresholds): string[] {
  const out: string[] = [];
  if (s.usdc < t.minUsdc) {
    out.push(
      `USDC reserve low: ${s.usdc.toFixed(4)} < ${t.minUsdc} — Gateway deposits will fail; top up the funder wallet.`,
    );
  }
  if (s.gas < t.minGas) {
    out.push(
      `gas low: ${s.gas.toFixed(4)} < ${t.minGas} native USDC — top-up txs will fail; refuel the funder wallet.`,
    );
  }
  return out;
}
