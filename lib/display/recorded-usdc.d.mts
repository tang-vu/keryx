export type DisplayOptions = {
  denomination?: "$" | "USDC" | "test USDC";
  minimumFractionDigits?: 0 | 2 | 4 | 6;
};
export function recordedUsdcMicros(value: unknown): bigint | null;
export function formatUsdcMicros(value: unknown, options?: DisplayOptions): string;
export function formatRecordedUsdc(value: unknown, options?: DisplayOptions): string;
export function sumRecordedUsdc(values: readonly unknown[]): bigint | null;
