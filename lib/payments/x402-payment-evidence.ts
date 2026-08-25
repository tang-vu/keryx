import { config } from "../config";

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    verifyingContract: string;
  };
}

export function atomicUsdc(amount: number): string {
  return Math.max(1, Math.round(amount * 1_000_000)).toString();
}

export function sameAddress(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

/** Preserve the exact signed EIP-3009 validity boundary without retaining the signature. */
export function authorizationExpiryIso(validBefore: unknown): string {
  if (typeof validBefore !== "string" || !/^\d+$/.test(validBefore)) {
    throw new Error("signed authorization has an invalid validBefore");
  }
  const seconds = Number(validBefore);
  const maxDateSeconds = 8_640_000_000_000;
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > maxDateSeconds) {
    throw new Error("signed authorization validBefore is outside the supported date range");
  }
  return new Date(seconds * 1_000).toISOString();
}

/** A 402 challenge must equal the payee and integer micro-USDC amount already authorised by the
 * orchestrator. A paid endpoint does not get to redefine a reserved spend. */
export function assertExpectedRequirements(
  requirements: PaymentRequirements,
  expectedPayee: string,
  expectedAmount: number,
): void {
  if (requirements.scheme !== "exact") throw new Error("402 challenge has an unsupported scheme");
  if (requirements.network !== config.networkId) throw new Error("402 challenge has the wrong network");
  if (!sameAddress(requirements.asset, config.usdcAddress)) throw new Error("402 challenge has the wrong asset");
  if (!sameAddress(requirements.payTo, expectedPayee)) throw new Error("402 challenge payTo does not match the authorised creator");
  if (requirements.amount !== atomicUsdc(expectedAmount)) throw new Error("402 challenge amount does not match the reserved spend");
  if (requirements.maxTimeoutSeconds !== config.maxTimeoutSeconds) {
    throw new Error("402 challenge has an unexpected authorization lifetime");
  }
  if (!sameAddress(requirements.extra?.verifyingContract ?? "", config.gatewayWallet)) {
    throw new Error("402 challenge has the wrong Gateway contract");
  }
  if (requirements.extra?.name !== "GatewayWalletBatched" || requirements.extra?.version !== "1") {
    throw new Error("402 challenge has an unsupported signing domain");
  }
}

/** A Circle settlement reference is accepted only for the payer and network that submitted it. */
export function settlementReference(encoded: string | null, expectedPayer: string): string | null {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
    if (
      parsed?.success === true &&
      typeof parsed.transaction === "string" &&
      parsed.transaction.length > 0 &&
      typeof parsed.payer === "string" &&
      sameAddress(parsed.payer, expectedPayer) &&
      parsed.network === config.networkId
    ) {
      return parsed.transaction;
    }
  } catch { /* invalid settlement proof remains unconfirmed */ }
  return null;
}
