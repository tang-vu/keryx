import type { PaymentSettlementStatus } from "../types";
import { config } from "../config";
import {
  assertExpectedRequirements,
  authorizationExpiryIso,
  settlementReference,
  type PaymentRequirements,
} from "./x402-payment-evidence";

interface ChallengeBody {
  x402Version: number;
  resource?: Record<string, unknown>;
  accepts?: PaymentRequirements[];
}

interface BatchPayloadSigner {
  createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<{ x402Version: number; payload: unknown }>;
}

export interface ServerX402Attempt<T> {
  delivered: boolean;
  data?: T;
  settlementStatus: Extract<PaymentSettlementStatus, "settled" | "pending">;
  transaction: string | null;
  authorizationId: string;
  authorizationExpiresAt: string;
  amountUsdc: number;
  httpStatus?: number;
  reason?: string;
}

interface PayWithServerSignerInput {
  url: string;
  method: "GET" | "POST";
  expectedPayee: string;
  expectedAmount: number;
  payer: string;
  signer: BatchPayloadSigner;
  fetchImpl?: typeof fetch;
}

/** Circle's GatewayClient throws away PAYMENT-RESPONSE on non-2xx paid responses. Keryx needs the
 * receipt even when delivery fails after settlement, so this small transport keeps signing in the
 * official BatchEvmScheme while owning response classification itself. No signature is returned. */
export async function payWithServerSigner<T>({
  url,
  method,
  expectedPayee,
  expectedAmount,
  payer,
  signer,
  fetchImpl = fetch,
}: PayWithServerSignerInput): Promise<ServerX402Attempt<T>> {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const challengeResponse = await fetchImpl(url, { method, headers });
  if (challengeResponse.status !== 402) {
    throw new Error(`expected 402 from ${url}, got ${challengeResponse.status}`);
  }

  const encodedChallenge = challengeResponse.headers.get("PAYMENT-REQUIRED");
  if (!encodedChallenge) throw new Error("402 response missing PAYMENT-REQUIRED header");

  let challenge: ChallengeBody;
  try {
    challenge = JSON.parse(Buffer.from(encodedChallenge, "base64").toString("utf-8")) as ChallengeBody;
  } catch {
    throw new Error("could not parse PAYMENT-REQUIRED header");
  }
  if (challenge.x402Version !== 2) {
    throw new Error(`unsupported x402 challenge version: ${challenge.x402Version}`);
  }

  const requirements = challenge.accepts?.find(
    (candidate) => candidate.network === config.networkId && candidate.scheme === "exact",
  ) ?? challenge.accepts?.[0];
  if (!requirements) throw new Error(`no usable payment requirements in 402 from ${url}`);
  assertExpectedRequirements(requirements, expectedPayee, expectedAmount);

  const signed = await signer.createPaymentPayload(challenge.x402Version, requirements);
  const authorization = authorizationEvidence(signed.payload);
  const paymentHeader = Buffer.from(JSON.stringify({
    ...signed,
    resource: challenge.resource ?? { url },
    accepted: requirements,
  })).toString("base64");

  let paidResponse: Response;
  try {
    paidResponse = await fetchImpl(url, {
      method,
      headers: { ...headers, "Payment-Signature": paymentHeader },
    });
  } catch (error) {
    return {
      delivered: false,
      settlementStatus: "pending",
      transaction: null,
      ...authorization,
      amountUsdc: expectedAmount,
      reason: errorMessage(error),
    };
  }

  const transaction = settlementReference(
    paidResponse.headers.get("PAYMENT-RESPONSE"),
    payer,
  );
  const settlementStatus = transaction ? "settled" : "pending";
  const base = {
    settlementStatus,
    transaction,
    ...authorization,
    amountUsdc: expectedAmount,
    httpStatus: paidResponse.status,
  } as const;

  if (!paidResponse.ok) {
    return { ...base, delivered: false, reason: `HTTP ${paidResponse.status}` };
  }

  try {
    return { ...base, delivered: true, data: await paidResponse.json() as T };
  } catch {
    return { ...base, delivered: false, reason: "paid route returned invalid JSON" };
  }
}

function authorizationEvidence(payload: unknown): {
  authorizationId: string;
  authorizationExpiresAt: string;
} {
  const authorization = (
    payload as { authorization?: { nonce?: unknown; validBefore?: unknown } } | null
  )?.authorization;
  if (typeof authorization?.nonce !== "string" || !/^0x[0-9a-f]{64}$/i.test(authorization.nonce)) {
    throw new Error("batch signer returned an invalid authorization nonce");
  }
  return {
    authorizationId: authorization.nonce,
    authorizationExpiresAt: authorizationExpiryIso(authorization.validBefore),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
