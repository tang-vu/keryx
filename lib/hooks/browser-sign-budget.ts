/** A per-ask browser cap in exact micro-USDC. Reserve synchronously before any
 * asynchronous authority check so simultaneous SSE frames cannot overbook it. */
export class BrowserSignBudget {
  private readonly capMicros: bigint | null;
  private heldMicros = BigInt(0);

  constructor(capUsdc: number | undefined) {
    this.capMicros = capToMicros(capUsdc);
  }

  reserve(amountText: unknown): BrowserSignReservation | null {
    if (this.capMicros === null || typeof amountText !== "string" || amountText.length > 20 ||
        !/^[1-9]\d*$/.test(amountText)) return null;
    const amount = BigInt(amountText);
    if (this.heldMicros + amount > this.capMicros) return null;
    this.heldMicros += amount;
    let signingMayHaveStarted = false;
    let released = false;
    return {
      markSigningStarted: () => { signingMayHaveStarted = true; },
      releaseBeforeSigning: () => {
        if (released || signingMayHaveStarted) return;
        released = true;
        this.heldMicros -= amount;
      },
    };
  }
}

export interface BrowserSignReservation {
  /** Call immediately before invoking the signer. Capacity stays held thereafter. */
  markSigningStarted(): void;
  /** Idempotent; a possibly signed authorization never releases local capacity. */
  releaseBeforeSigning(): void;
}

function capToMicros(cap: number | undefined): bigint | null {
  if (cap === undefined || !Number.isFinite(cap) || cap <= 0) return null;
  // Floor the decimal representation. Floating-point noise can understate a cap
  // by one micro-USDC, but must never round it upward and authorize extra spend.
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(cap));
  if (!match) return null;
  return BigInt(match[1]) * BigInt(1_000_000) + BigInt((match[2] ?? "").padEnd(6, "0").slice(0, 6));
}
