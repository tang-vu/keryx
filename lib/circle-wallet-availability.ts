/** Public readiness is a read-only prerequisite, never wallet or spending authority. */
export const CIRCLE_WALLET_AVAILABILITY_TIMEOUT_MS = 30_000;

export async function readCircleWalletAvailability(signal?: AbortSignal): Promise<boolean> {
  const deadline = AbortSignal.timeout(CIRCLE_WALLET_AVAILABILITY_TIMEOUT_MS);
  const response = await fetch("/api/auth/circle/config", {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  if (!response.ok) throw new Error("Google wallet availability could not be checked");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("available" in value) || typeof value.available !== "boolean") {
    throw new Error("Google wallet availability could not be checked");
  }
  return value.available;
}
