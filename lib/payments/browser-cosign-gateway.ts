/**
 * BrowserCoSignGateway — PaymentGateway implementation for the non-custodial
 * browser co-sign flow.
 *
 * For each source the agent wants to buy, this gateway:
 *   1. GETs the source URL to obtain the 402 challenge and payment requirements.
 *   2. Pre-spend guards: checks the grant cap before asking the browser.
 *   3. Emits a `sign-request` SSE event to the browser via the injected callback.
 *   4. Awaits the signed `payment-signature` header from POST /api/ask/sign.
 *   5. Retries the source with the header to trigger server-side verify+settle.
 *   6. Maps the response to a PaymentRecord.
 *
 * No private key is held or seen on the server side. The session EOA key
 * lives only in the browser tab that generated it.
 */

import { config } from "../config";
import type {
  ArticleOfferRef,
  Author,
  PaymentRecord,
  Source,
  SourceItem,
  SourceItemIdentity,
} from "../types";
import {
  matchesSourceItemIdentity,
  sourceItemIdentity,
} from "../sources/source-item-asset";
import { sourceFetchPayTo } from "../registry/source-fetch-payto";
import { articlePaidPath } from "../offers/resolve-article-offer";
import {
  makePayment,
  type FetchResult,
  type PaymentGateway,
} from "./payment-gateway";
import { PaymentPendingError, PaymentSettledError } from "./payment-state";
import { getGrant } from "./session-grants";
import { getDb } from "../db";
import { createHash } from "node:crypto";
import { verifyBrowserSignature } from "./verify-browser-signature";
import { sendAlert } from "../notify/alert";
import type { BrowserAuthorizationJournal } from "../db/browser-authorization-journal";
import {
  assertExpectedRequirements,
  authorizationExpiryIso,
  sameAddress,
  settlementReference,
  type PaymentRequirements,
} from "./x402-payment-evidence";

export type { PaymentRequirements } from "./x402-payment-evidence";

export interface SignRequest {
  reqId: string;
  /** Full payment requirements object from the source's 402 challenge. */
  requirements: PaymentRequirements;
}

export interface BrowserPaymentContext {
  item?: SourceItemIdentity;
  offer?: ArticleOfferRef;
}

interface ChallengeBody {
  x402Version: number;
  accepts: PaymentRequirements[];
}

interface SignedAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

interface SignedHeaderBody {
  signature: string;
  authorization: SignedAuthorization;
}

/**
 * Called by the SSE route to emit a `sign-request` event to the browser and
 * return a promise that resolves when the browser posts the signed header.
 * This function is injected so the gateway has no direct coupling to the SSE
 * controller — keeps the gateway testable.
 */
export type RequestSignatureFn = (
  reqId: string,
  requirements: PaymentRequirements,
  /** Distinguishes a fetch toll (payTo = source wallet) from a citation reward
   *  (payTo = author wallet). The browser uses this to scope its payTo allow-list. */
  kind: "fetch" | "citation",
  /** Which source this payment is for. The browser resolves the source's authorised
   *  wallets from it — for citations that is the only way to check payTo, since author
   *  wallets are deliberately not enumerable from any public endpoint. */
  sourceId: string,
  /** Exact article terms the browser independently checks before signing a fetch. */
  paymentContext: BrowserPaymentContext | undefined,
  admittedNonce: string
) => Promise<string>;

export class BrowserCoSignGateway implements PaymentGateway {
  readonly mode = "real" as const;

  constructor(
    private readonly sessionId: string,
    /** Captured at construction: the PaymentGateway contract exposes agentAddress() synchronously,
     *  and the grant now lives in the database. The factory has already loaded the grant to decide
     *  this gateway applies, so it hands the address down rather than re-reading it. */
    private readonly sessAddr: string,
    private readonly requestSignature: RequestSignatureFn,
    private readonly abortSignal?: AbortSignal,
    /** Generation of the cap reservation. A later Circle failure may release only this epoch. */
    private readonly grantEpoch: string = "legacy-test-grant"
  ) {}

  agentAddress(): string {
    return this.sessAddr;
  }

  async ensureFunded(_budget: number): Promise<{ address: string }> {
    // The user already funded the session EOA and deposited into the Gateway
    // as part of the grant flow (grant POST clamped the cap to the real balance). No-op here.
    return { address: this.sessAddr };
  }

  async payFetch({
    source,
    item,
    queryId,
    priceUsdc = source.fetchPrice,
    offer,
  }: {
    source: Source;
    item?: SourceItem;
    queryId: string;
    priceUsdc?: number;
    offer?: ArticleOfferRef;
  }): Promise<FetchResult> {
    const url = item
      ? `${config.baseUrl}${articlePaidPath({
          sourceId: source.id,
          itemId: item.id,
          contentVersion: sourceItemIdentity(item).contentVersion,
          offerId: offer?.id,
          listPriceUsdc: offer?.listPriceUsdc,
        })}`
      : `${config.baseUrl}/api/source/${source.id}`;
    const identity = item ? sourceItemIdentity(item) : undefined;
    const fetchPayee = await sourceFetchPayTo(source);
    const { content, payment } = await this.buyWithCoSign(
      url,
      source,
      queryId,
      "fetch",
      priceUsdc,
      undefined,
      undefined,
      undefined,
      identity,
      fetchPayee,
      offer
    );
    return { content, payment };
  }

  async payCitation({
    source,
    author,
    item,
    amount,
    weight,
    queryId,
    rationale,
  }: {
    source: Source;
    author: Author;
    item?: SourceItemIdentity;
    amount: number;
    weight: number;
    queryId: string;
    rationale: string;
  }): Promise<PaymentRecord> {
    const url = `${config.baseUrl}/api/cite/${
      source.id
    }?author=${encodeURIComponent(
      author.walletAddress
    )}&amount=${amount.toFixed(6)}`;
    const { payment } = await this.buyWithCoSign(
      url,
      source,
      queryId,
      "citation",
      amount,
      weight,
      rationale,
      author,
      item
    );
    return payment;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async buyWithCoSign(
    url: string,
    source: Source,
    queryId: string,
    kind: "fetch" | "citation",
    amount: number,
    weight?: number,
    rationale?: string,
    author?: Author,
    item?: SourceItemIdentity,
    payeeOverride?: string,
    offer?: ArticleOfferRef
  ): Promise<{ content: string; payment: PaymentRecord }> {
    // Guard: abort if client disconnected or grant revoked.
    if (this.abortSignal?.aborted) {
      throw new Error("client disconnected");
    }

    if (!(await this.hasCapturedGrant())) {
      throw new Error("session grant expired or revoked — aborting spend");
    }

    // Step 1: hit the URL without a payment header to obtain the 402 challenge.
    // The challenge MUST be requested with the same method the paid retry will use:
    // /api/source is GET, but /api/cite is POST-only (a GET there returns 405, not 402).
    const reqId = crypto.randomUUID();
    const method = kind === "fetch" ? "GET" : "POST";
    const requirements = await this.fetchRequirements(url, method);
    const payee =
      payeeOverride ?? author?.walletAddress ?? source.walletAddress;
    assertExpectedRequirements(requirements, payee, amount);

    const db = await getDb();
    const admission = await db.admitBrowserJournal({
      sessionId: this.sessionId,
      requestId: reqId,
      queryId,
      grantEpoch: this.grantEpoch,
      signer: this.sessAddr,
      network: config.profile.networkId,
      token: requirements.asset,
      gatewayContract: requirements.extra.verifyingContract,
      sourceId: source.id,
      offerId: offer?.id ?? null,
      kind,
      payee,
      amountMicroUsdc: Number(requirements.amount),
      requirements,
      ...(config.profile.name === "arc" && kind === "fetch" ? { paymentContext: { item, offer } } : {}),
      payment: {
        kind,
        queryId,
        sourceId: source.id,
        sourceName: source.name,
        ...item,
        offerId: offer?.id,
        listPriceUsdc: offer?.listPriceUsdc,
        payer: this.sessAddr,
        payee,
        amountUsdc: amount,
        weight,
        rationale,
        network: config.profile.networkId,
        grantEpoch: this.grantEpoch,
        origin: "web",
      },
    });
    if (admission.status !== "admitted")
      throw new Error(
        `browser authorization admission refused (${admission.status})`
      );
    const journal = admission.journal;
    const pendingExposure = () => ({
      ...journal.payment,
      authorizationPhase: "exposed" as const,
    });
    const recoveredFailure = (
      message: string,
      recovered: BrowserAuthorizationJournal | null,
      fallback: PaymentRecord
    ): never => {
      if (recovered?.phase === "settled")
        throw new PaymentSettledError(message, recovered.payment);
      if (
        recovered?.phase === "failed" ||
        recovered?.phase === "cancelled_unexposed"
      )
        throw new Error(
          "authorization reached a durable terminal state before delivery"
        );
      throw new PaymentPendingError(
        message,
        recovered?.payment ?? fallback,
        false
      );
    };
    try {
      if (this.abortSignal?.aborted || !(await this.hasCapturedGrant())) {
        await db.cancelPreparedBrowserJournal(this.sessionId, reqId);
        throw new Error("browser authorization cancelled before exposure");
      }
      if (!(await db.exposeBrowserJournal(this.sessionId, reqId)))
        throw new Error("browser authorization exposure refused");
    } catch (error) {
      // Cancellation is CAS-only: it cannot release if exposure may have committed.
      const cancelled = await db
        .cancelPreparedBrowserJournal(this.sessionId, reqId)
        .catch(() => false);
      if (cancelled) throw error;
      const recovered = await db
        .getBrowserJournal(this.sessionId, reqId)
        .catch(() => null);
      if (recovered?.phase === "cancelled_unexposed") throw error;
      void sendAlert(
        "browser authorization exposure write uncertain",
        `nonce=${journal.nonce}; phase=${recovered?.phase ?? "unknown"}`
      ).catch(() => undefined);
      return recoveredFailure(
        "authorization exposure acknowledgement unavailable; reservation retained",
        recovered,
        pendingExposure()
      );
    }

    // Step 2: Ask the browser to sign. The browser validates payTo/amount against
    // the grant cap before signing — defence against a compromised server sending
    // inflated amounts. The server enforces the pre-spend guard above as a second layer.
    let paymentHeader: string;
    let signed: SignedHeaderBody;
    try {
      paymentHeader = await this.requestSignature(
        reqId,
        requirements,
        kind,
        source.id,
        kind === "fetch" ? { item, offer } : undefined,
        journal.nonce
      );
      signed = parseAndValidateSignedHeader(
        paymentHeader,
        requirements,
        this.sessAddr
      );
      await verifyBrowserSignature(paymentHeader, {
        requirements,
        expectedSigner: this.sessAddr,
        expectedNonce: journal.nonce,
      });
      if (
        !(await db.signBrowserJournal(this.sessionId, reqId, {
          validAfter: signed.authorization.validAfter,
          validBefore: signed.authorization.validBefore,
          headerHash: createHash("sha256").update(paymentHeader).digest("hex"),
        }))
      )
        throw new Error("durable signed authorization acknowledgement refused");
    } catch (err) {
      void err; // Header errors must not leak a bearer through logs or SSE.
      const recovered = await db
        .getBrowserJournal(this.sessionId, reqId)
        .catch(() => null);
      return recoveredFailure(
        "exposed authorization remains reserved; signature or callback acknowledgement unavailable",
        recovered,
        pendingExposure()
      );
    }

    // Step 3: Retry with the signed header — triggers verify+settle server-side.
    const payer = this.sessAddr;
    const basePayment = {
      id: `x402:${signed.authorization.nonce}`,
      createdAt: journal.payment.createdAt,
      kind,
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      ...item,
      offerId: offer?.id,
      listPriceUsdc: offer?.listPriceUsdc,
      payer,
      payee,
      amountUsdc: amount,
      weight,
      authorizationId: signed.authorization.nonce,
      authorizationExpiresAt: authorizationExpiryIso(
        signed.authorization.validBefore
      ),
      grantEpoch: this.grantEpoch,
      authorizationPhase: "signed" as PaymentRecord["authorizationPhase"],
    };
    const pending = (reason: string) =>
      makePayment({
        ...basePayment,
        txHash: null,
        settled: false,
        settlementStatus: "pending",
        rationale: `Signed x402 authorization submitted; settlement confirmation unavailable (${reason}).`,
      });

    // The browser produced this bearer header and may still possess it. Even if Keryx withholds
    // submission, another holder could submit it; retain the reservation and reconcile by nonce.
    let grantCurrent = false;
    try {
      if (!this.abortSignal?.aborted)
        grantCurrent = await this.hasCapturedGrant();
    } catch {
      // A storage failure leaves grant authority unknown. Fail closed and retain capacity.
    }
    if (!grantCurrent || this.abortSignal?.aborted) {
      throw new PaymentPendingError(
        "signed authorization withheld before submission; external use remains uncertain",
        makePayment({
          ...basePayment,
          txHash: null,
          settled: false,
          settlementStatus: "pending",
          rationale:
            "Signed x402 authorization created, but Keryx withheld submission after the browser grant changed, could not be verified, or the client disconnected. External use remains uncertain.",
        }),
        false
      );
    }

    try {
      if (!(await db.submitBrowserJournal(this.sessionId, reqId)))
        throw new Error("transition refused");
    } catch {
      const recovered = await db
        .getBrowserJournal(this.sessionId, reqId)
        .catch(() => null);
      void sendAlert(
        "browser authorization submission write uncertain",
        `nonce=${journal.nonce}; phase=${recovered?.phase ?? "unknown"}`
      ).catch(() => undefined);
      return recoveredFailure(
        "durable submission acknowledgement unavailable",
        recovered,
        { ...journal.payment, authorizationPhase: "signed" }
      );
    }
    basePayment.authorizationPhase = "submission_attempted";
    let retryRes: Response;
    try {
      retryRes = await fetch(url, {
        method,
        headers: {
          "payment-signature": paymentHeader,
          Accept: "application/json",
        },
        signal: this.abortSignal,
      });
    } catch (err) {
      const reason = errorMessage(err);
      throw new PaymentPendingError(
        `settlement confirmation pending after signed submission (${reason})`,
        pending(reason)
      );
    }

    // Step 4: Extract settlement proof before interpreting the HTTP delivery status. A paid route
    // can fail while producing content after Circle has already confirmed the debit; its 5xx still
    // carries PAYMENT-RESPONSE and must remain settled rather than being relabelled pending.
    const paymentResponse = retryRes.headers.get("PAYMENT-RESPONSE");
    const txHash = settlementReference(paymentResponse, payer);
    if (txHash) {
      try {
        if (
          !(await db.settlePendingPayment(
            journal.payment.id!,
            journal.nonce,
            txHash
          ))
        ) {
          const recovered = await db.getBrowserJournal(this.sessionId, reqId);
          if (
            recovered?.phase !== "settled" ||
            recovered.payment.txHash !== txHash
          )
            throw new Error("terminal state conflict");
        }
      } catch {
        void sendAlert(
          "browser authorization receipt write requires recovery",
          `nonce=${journal.nonce}; receipt=${txHash}`
        ).catch(() => undefined);
        throw new PaymentSettledError(
          "payment settled; durable confirmation write requires reconciliation",
          makePayment({
            ...basePayment,
            txHash,
            settled: true,
            settlementStatus: "settled",
            authorizationPhase: "settled",
          })
        );
      }
    }
    basePayment.authorizationPhase = txHash
      ? "settled"
      : "submission_attempted";

    if (!retryRes.ok) {
      const reason = `HTTP ${retryRes.status}`;
      if (txHash) {
        throw new PaymentSettledError(
          `payment settled, but the paid route could not deliver its response (${reason})`,
          makePayment({
            ...basePayment,
            txHash,
            settled: true,
            settlementStatus: "settled",
            rationale: `Circle settlement confirmed, but the paid route returned ${reason}.`,
          })
        );
      }
      throw new PaymentPendingError(
        `settlement confirmation pending after signed submission (${reason})`,
        pending(reason)
      );
    }

    const bodyJson = (await retryRes.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const content =
      (bodyJson.content as string) ??
      (bodyJson.text as string) ??
      JSON.stringify(bodyJson);

    const payment = makePayment({
      ...basePayment,
      txHash,
      settled: txHash !== null,
      settlementStatus: txHash ? "settled" : "pending",
      rationale: txHash
        ? rationale ?? "Browser co-sign toll settled on Arc via x402."
        : "Content returned after signed x402 submission, but the settlement response was missing or invalid.",
    });

    if (item && !matchesSourceItemIdentity(bodyJson.item, item)) {
      const reason = "paid response did not match the selected article version";
      if (payment.settled) {
        payment.rationale = `Circle settlement confirmed, but ${reason}.`;
        throw new PaymentSettledError(
          `payment settled, but ${source.name} returned a different article identity`,
          payment
        );
      }
      throw new PaymentPendingError(
        `settlement confirmation pending and ${reason}`,
        payment
      );
    }

    if (item && !matchesArticlePricing(bodyJson.pricing, amount, offer)) {
      const reason = "paid response did not match the selected article offer";
      if (payment.settled) {
        payment.rationale = `Circle settlement confirmed, but ${reason}.`;
        throw new PaymentSettledError(
          `payment settled, but ${source.name} returned different article pricing`,
          payment
        );
      }
      throw new PaymentPendingError(
        `settlement confirmation pending and ${reason}`,
        payment
      );
    }

    return { content, payment };
  }

  private async hasCapturedGrant(): Promise<boolean> {
    const grant = await getGrant(this.sessionId);
    return (
      grant?.grantEpoch === this.grantEpoch &&
      grant.sessAddr.toLowerCase() === this.sessAddr.toLowerCase()
    );
  }

  /**
   * GET the URL without payment to obtain the 402 challenge.
   * Returns the first matching payment requirements object (Arc / exact scheme).
   */
  private async fetchRequirements(
    url: string,
    method: "GET" | "POST"
  ): Promise<PaymentRequirements> {
    const res = await fetch(url, {
      method,
      headers: { Accept: "application/json" },
      signal: this.abortSignal,
    });

    if (res.status !== 402) {
      throw new Error(`expected 402 from ${url}, got ${res.status}`);
    }

    const encoded = res.headers.get("PAYMENT-REQUIRED");
    if (!encoded) {
      throw new Error("402 response missing PAYMENT-REQUIRED header");
    }

    let challenge: ChallengeBody;
    try {
      challenge = JSON.parse(
        Buffer.from(encoded, "base64").toString("utf-8")
      ) as ChallengeBody;
    } catch {
      throw new Error("could not parse PAYMENT-REQUIRED header");
    }
    if (challenge.x402Version !== 2) {
      throw new Error(
        `unsupported x402 challenge version: ${challenge.x402Version}`
      );
    }

    const reqs = challenge.accepts ?? [];
    // Prefer the Arc testnet option matching our configured network.
    const match =
      reqs.find(
        (r) => r.network === config.networkId && r.scheme === "exact"
      ) ?? reqs[0];

    if (!match) {
      throw new Error(`no usable payment requirements in 402 from ${url}`);
    }

    return match;
  }
}

function matchesArticlePricing(
  value: unknown,
  expectedPrice: number,
  offer?: ArticleOfferRef
): boolean {
  if (!value || typeof value !== "object") return false;
  const pricing = value as {
    offerId?: string | null;
    priceUsdc?: number;
    listPriceUsdc?: number;
  };
  return (
    pricing.offerId === (offer?.id ?? null) &&
    Math.abs(Number(pricing.priceUsdc) - expectedPrice) < 0.0000005 &&
    (!offer ||
      Math.abs(Number(pricing.listPriceUsdc) - offer.listPriceUsdc) < 0.0000005)
  );
}

/** Reject malformed data before submission. Exposure already happened: rejection never
 * proves that no usable authorization exists and cannot release retained capacity. */
function parseAndValidateSignedHeader(
  header: string,
  requirements: PaymentRequirements,
  sessionAddress: string
): SignedHeaderBody {
  let body: SignedHeaderBody;
  try {
    body = JSON.parse(
      Buffer.from(header, "base64").toString("utf-8")
    ) as SignedHeaderBody;
  } catch {
    throw new Error("browser returned an invalid payment header");
  }
  // This gateway sends the header directly to the seller, which prefers a nested `.payload`.
  // Do not allow a second authorization to bypass the callback's verified inner blob.
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "authorization,signature"
  ) {
    throw new Error("browser returned an ambiguous payment header");
  }
  const auth = body?.authorization;
  if (
    !auth ||
    typeof body.signature !== "string" ||
    !/^0x[0-9a-f]{130}$/i.test(body.signature)
  ) {
    throw new Error("browser returned an incomplete payment authorization");
  }
  if (!sameAddress(auth.from ?? "", sessionAddress))
    throw new Error("payment authorization signer does not match the session");
  if (!sameAddress(auth.to ?? "", requirements.payTo))
    throw new Error("payment authorization payTo does not match the challenge");
  if (String(auth.value) !== requirements.amount)
    throw new Error(
      "payment authorization amount does not match the challenge"
    );
  if (!/^0x[0-9a-f]{64}$/i.test(auth.nonce ?? ""))
    throw new Error("payment authorization nonce is invalid");
  if (
    !/^\d+$/.test(String(auth.validAfter)) ||
    !/^\d+$/.test(String(auth.validBefore))
  ) {
    throw new Error("payment authorization validity window is invalid");
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = BigInt(auth.validAfter);
  const validBefore = BigInt(auth.validBefore);
  if (
    validAfter > now ||
    validAfter < now - BigInt(3_600) ||
    validBefore <= now ||
    validBefore > now + BigInt(requirements.maxTimeoutSeconds + 300)
  ) {
    throw new Error(
      "payment authorization validity window does not match the challenge"
    );
  }
  return body;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
