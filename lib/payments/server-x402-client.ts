import type { PaymentSettlementStatus } from "../types";
import { createHash } from "node:crypto";
import type { AdmittedSettlementRequest, SettlementReceiptHint } from "../gateway/settlement-events";
import { config } from "../config";
import { assertRecipientAllowed, type RecipientExclusion } from "./recipient-exclusion";
import {
  assertExpectedRequirements,
  atomicUsdc,
  authorizationExpiryIso,
  settlementReference,
  type PaymentRequirements,
} from "./x402-payment-evidence";

interface ChallengeBody {
  x402Version: number;
  resource?: Record<string, unknown>;
  accepts?: PaymentRequirements[];
}

export interface BatchPayloadSigner {
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
  authorizationPhase?: import("../db/browser-authorization-journal").BrowserAuthorizationPhase;
}

/** Non-bearer evidence for a durable pre-submit journal. Never includes the signature/header. */
export interface ServerX402Submission {
  authorizationId: string;
  authorizationExpiresAt: string;
  payer: string;
  payee: string;
  amountMicros: string;
  network: string;
  asset: string;
}

interface PayWithServerSignerInput extends RecipientExclusion {
  url: string;
  method: "GET" | "POST";
  expectedPayee: string;
  expectedAmount: number;
  payer: string;
  signer: BatchPayloadSigner;
  fetchImpl?: typeof fetch;
  /** Must durably admit this exact attempt or throw. Called before signed HTTP I/O, never retried here. */
  beforeSubmit?: (submission: Readonly<ServerX402Submission>) => Promise<void>;
  beforeSignedSubmit?: (submission: Readonly<ServerX402Submission>, headerHash: string) => Promise<void>;
  /** Owned retained original only. This port is passive; it never admits or settles a payment. */
  settlementObserver?: {
    readonly admittedRequest?: AdmittedSettlementRequest;
    readonly observe: (signal: ServerX402TransportObservation) => void | Promise<void>;
  };
}

/** Private, bounded scalar snapshot. Receipt hints are never independent settlement proof. */
export interface ServerX402TransportObservation {
  readonly kind: "server-x402-transport";
  readonly admittedRequest: AdmittedSettlementRequest | null;
  readonly receiptHint: SettlementReceiptHint | null;
  readonly delivered: boolean;
  readonly httpStatus: number | null;
}

/** Circle's GatewayClient throws away PAYMENT-RESPONSE on non-2xx paid responses. Keryx needs the
 * receipt even when delivery fails after settlement, so this small transport keeps signing in the
 * official BatchEvmScheme while owning response classification itself. No signature is returned. */
export async function payWithServerSigner<T>({
  url,
  method,
  expectedPayee,
  deniedRecipient,
  expectedAmount,
  payer,
  signer,
  fetchImpl = fetch,
  beforeSubmit,
  beforeSignedSubmit,
  settlementObserver,
}: PayWithServerSignerInput): Promise<ServerX402Attempt<T>> {
  assertRecipientAllowed(expectedPayee, deniedRecipient);
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
  assertRecipientAllowed(requirements.payTo, deniedRecipient);
  assertExpectedRequirements(requirements, expectedPayee, expectedAmount);
  const network = requirements.network;
  const asset = requirements.asset;

  const signed = await signer.createPaymentPayload(challenge.x402Version, requirements);
  assertRecipientAllowed((signed.payload as { authorization?: { to?: unknown } } | null)?.authorization?.to, deniedRecipient);
  const authorization = authorizationEvidence(signed.payload);
  const paymentHeader = Buffer.from(JSON.stringify({
    ...signed,
    resource: challenge.resource ?? { url },
    accepted: requirements,
  })).toString("base64");

  let observedOriginal: AdmittedSettlementRequest | null = null;
  if (beforeSubmit || beforeSignedSubmit) {
    const signedAuthorization = (signed.payload as { authorization?: { from?: unknown; to?: unknown; value?: unknown } } | null)?.authorization;
    const amountMicros = atomicUsdc(expectedAmount);
    if (typeof signedAuthorization?.from !== "string" || signedAuthorization.from.toLowerCase() !== payer.toLowerCase()
      || typeof signedAuthorization.to !== "string" || signedAuthorization.to.toLowerCase() !== expectedPayee.toLowerCase()
      || signedAuthorization.value !== amountMicros) {
      throw new Error("Signed payment does not match submission journal identity");
    }
    // Header and scalar evidence are captured before the callback; it cannot rewrite the payment.
    // Outside the transport catch: a failed journal must never cause a signed request.
    const submission = Object.freeze({ ...authorization, authorizationId: authorization.authorizationId.toLowerCase(),
      payer: payer.toLowerCase(), payee: expectedPayee.toLowerCase(), amountMicros, network, asset: asset.toLowerCase() });
    // Snapshot before journal callbacks; optional observer input cannot rewrite signed terms.
    const original = matchingObservedOriginal(settlementObserver, submission, expectedAmount);
    await beforeSubmit?.(submission);
    await beforeSignedSubmit?.(submission, `0x${createHash("sha256").update(paymentHeader).digest("hex")}`);
    observedOriginal = original;
  }

  const finish = (result: ServerX402Attempt<T>): ServerX402Attempt<T> => {
    // No raw receipt, header, signature, URL, response body or error is exposed. No observer
    // promise is awaited: a lost retention acknowledgement cannot retry or delay payment.
    try {
      if (settlementObserver) {
        const transferId = result.transaction;
        const receiptHint = observedOriginal && transferId && /^[a-zA-Z0-9:_-]{1,128}$/.test(transferId)
          ? Object.freeze({ requestId: observedOriginal.requestId, transferId }) : null;
        const signal: ServerX402TransportObservation = Object.freeze({ kind: "server-x402-transport",
          admittedRequest: observedOriginal, receiptHint, delivered: result.delivered,
          httpStatus: result.httpStatus ?? null });
        void Promise.resolve(settlementObserver.observe(signal)).catch(() => {});
      }
    } catch { /* Passive observation failures never change a completed transport result. */ }
    return result;
  };

  let paidResponse: Response;
  try {
    paidResponse = await fetchImpl(url, {
      method,
      headers: { ...headers, "Payment-Signature": paymentHeader },
    });
  } catch (error) {
    return finish({
      delivered: false,
      settlementStatus: "pending",
      transaction: null,
      ...authorization,
      amountUsdc: expectedAmount,
      reason: errorMessage(error),
    });
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
    return finish({ ...base, delivered: false, reason: `HTTP ${paidResponse.status}` });
  }

  try {
    return finish({ ...base, delivered: true, data: await paidResponse.json() as T });
  } catch {
    return finish({ ...base, delivered: false, reason: "paid route returned invalid JSON" });
  }
}

function matchingObservedOriginal(
  observer: PayWithServerSignerInput["settlementObserver"],
  submission: Readonly<ServerX402Submission>,
  amountUsdc: number,
): AdmittedSettlementRequest | null {
  try {
    const r = observer?.admittedRequest;
    if (!r) return null;
    const requestId = r.requestId, submittedAt = r.submittedAt;
    const { payer, payee, network, authorizationId, createdAt, amountUsdc: originalAmount } = r.payment;
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(requestId)
      || typeof createdAt !== "string" || createdAt.length > 40 || !Number.isFinite(Date.parse(createdAt))
      || !(submittedAt === null || (typeof submittedAt === "string" && submittedAt.length <= 40 && Number.isFinite(Date.parse(submittedAt))))
      || typeof payer !== "string" || !/^0x[0-9a-f]{40}$/i.test(payer) || payer.toLowerCase() !== submission.payer
      || typeof payee !== "string" || !/^0x[0-9a-f]{40}$/i.test(payee) || payee.toLowerCase() !== submission.payee
      || typeof authorizationId !== "string" || authorizationId.toLowerCase() !== submission.authorizationId
      || network !== submission.network || typeof network !== "string" || network.length > 32
      || originalAmount !== amountUsdc) return null;
    return Object.freeze({ requestId, submittedAt, payment: Object.freeze({ payer: submission.payer,
      payee: submission.payee, authorizationId: submission.authorizationId, network, createdAt, amountUsdc }) });
  } catch { return null; }
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
