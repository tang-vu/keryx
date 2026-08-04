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
import type { Author, PaymentRecord, Source } from "../types";
import { makePayment, type FetchResult, type PaymentGateway } from "./payment-gateway";
import { PaymentPendingError } from "./payment-state";
import { isGrantValid, releaseSpend, reserveSpend } from "./session-grants";

export interface SignRequest {
  reqId: string;
  /** Full payment requirements object from the source's 402 challenge. */
  requirements: PaymentRequirements;
}

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
  ) {}

  agentAddress(): string {
    return this.sessAddr;
  }

  async ensureFunded(_budget: number): Promise<{ address: string }> {
    // The user already funded the session EOA and deposited into the Gateway
    // as part of the grant flow (grant POST clamped the cap to the real balance). No-op here.
    return { address: this.sessAddr };
  }

  async payFetch({ source, queryId }: { source: Source; queryId: string }): Promise<FetchResult> {
    const url = `${config.baseUrl}/api/source/${source.id}`;
    const { content, payment } = await this.buyWithCoSign(url, source, queryId, "fetch", source.fetchPrice);
    return { content, payment };
  }

  async payCitation({
    source,
    author,
    amount,
    weight,
    queryId,
    rationale,
  }: {
    source: Source;
    author: Author;
    amount: number;
    weight: number;
    queryId: string;
    rationale: string;
  }): Promise<PaymentRecord> {
    const url = `${config.baseUrl}/api/cite/${source.id}?author=${encodeURIComponent(
      author.walletAddress,
    )}&amount=${amount.toFixed(6)}&query=${encodeURIComponent(queryId)}`;
    const { payment } = await this.buyWithCoSign(url, source, queryId, "citation", amount, weight, rationale, author);
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
  ): Promise<{ content: string; payment: PaymentRecord }> {
    // Guard: abort if client disconnected or grant revoked.
    if (this.abortSignal?.aborted) {
      throw new Error("client disconnected");
    }

    if (!(await isGrantValid(this.sessionId))) {
      throw new Error("session grant expired or revoked — aborting spend");
    }

    // Step 1: hit the URL without a payment header to obtain the 402 challenge.
    // The challenge MUST be requested with the same method the paid retry will use:
    // /api/source is GET, but /api/cite is POST-only (a GET there returns 405, not 402).
    const reqId = crypto.randomUUID();
    const method = kind === "fetch" ? "GET" : "POST";
    const requirements = await this.fetchRequirements(url, method);
    const payee = author?.walletAddress ?? source.walletAddress;
    assertExpectedRequirements(requirements, payee, amount);

    // Reserve in one atomic DB operation before a bearer authorization can exist.
    if (!(await reserveSpend(this.sessionId, amount))) {
      throw new Error(`session cap would be exceeded (amount=${amount})`);
    }

    // Step 2: Ask the browser to sign. The browser validates payTo/amount against
    // the grant cap before signing — defence against a compromised server sending
    // inflated amounts. The server enforces the pre-spend guard above as a second layer.
    let paymentHeader: string;
    let signed: SignedHeaderBody;
    try {
      paymentHeader = await this.requestSignature(reqId, requirements, kind, source.id);
      signed = parseAndValidateSignedHeader(paymentHeader, requirements, this.sessAddr);
    } catch (err) {
      await releaseSpend(this.sessionId, amount).catch((releaseErr) => {
        console.error("[keryx] failed to release unused session reservation:", releaseErr);
      });
      // Timeout or revoke — record a skipped payment rather than crashing the run.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`sign-request failed (${message}) — skipping ${source.name}`);
    }

    // Step 3: Retry with the signed header — triggers verify+settle server-side.
    const payer = this.sessAddr;
    const basePayment = {
      id: `x402:${signed.authorization.nonce}`,
      kind,
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      payer,
      payee,
      amountUsdc: amount,
      weight,
      authorizationId: signed.authorization.nonce,
    } as const;
    const pending = (reason: string) => makePayment({
      ...basePayment,
      txHash: null,
      settled: false,
      settlementStatus: "pending",
      rationale: `Signed x402 authorization submitted; settlement confirmation unavailable (${reason}).`,
    });

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
        pending(reason),
      );
    }

    if (!retryRes.ok) {
      const reason = `HTTP ${retryRes.status}`;
      throw new PaymentPendingError(
        `settlement confirmation pending after signed submission (${reason})`,
        pending(reason),
      );
    }

    // Step 4: Extract the settled tx from the response header, if present.
    const paymentResponse = retryRes.headers.get("PAYMENT-RESPONSE");
    let txHash: string | null = null;
    if (paymentResponse) {
      try {
        const parsed = JSON.parse(Buffer.from(paymentResponse, "base64").toString("utf-8"));
        if (
          parsed?.success === true &&
          typeof parsed.transaction === "string" &&
          parsed.transaction.length > 0 &&
          typeof parsed.payer === "string" &&
          sameAddress(parsed.payer, payer) &&
          parsed.network === config.networkId
        ) {
          txHash = parsed.transaction;
        }
      } catch { /* non-critical */ }
    }

    const bodyJson = await retryRes.json().catch(() => ({})) as Record<string, unknown>;
    const content = (bodyJson.content as string) ?? (bodyJson.text as string) ?? JSON.stringify(bodyJson);

    const payment = makePayment({
      ...basePayment,
      txHash,
      settled: txHash !== null,
      settlementStatus: txHash ? "settled" : "pending",
      rationale: txHash
        ? (rationale ?? "Browser co-sign toll settled on Arc via x402.")
        : "Content returned after signed x402 submission, but the settlement response was missing or invalid.",
    });

    return { content, payment };
  }

  /**
   * GET the URL without payment to obtain the 402 challenge.
   * Returns the first matching payment requirements object (Arc / exact scheme).
   */
  private async fetchRequirements(url: string, method: "GET" | "POST"): Promise<PaymentRequirements> {
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
      challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8")) as ChallengeBody;
    } catch {
      throw new Error("could not parse PAYMENT-REQUIRED header");
    }
    if (challenge.x402Version !== 2) {
      throw new Error(`unsupported x402 challenge version: ${challenge.x402Version}`);
    }

    const reqs = challenge.accepts ?? [];
    // Prefer the Arc testnet option matching our configured network.
    const match = reqs.find((r) => r.network === config.networkId && r.scheme === "exact")
      ?? reqs[0];

    if (!match) {
      throw new Error(`no usable payment requirements in 402 from ${url}`);
    }

    return match;
  }
}

function atomicUsdc(amount: number): string {
  return Math.max(1, Math.round(amount * 1_000_000)).toString();
}

function sameAddress(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

/** A 402 challenge must equal the source/author and integer micro-USDC amount the orchestrator
 * already authorised. An endpoint does not get to redefine a reserved spend. */
function assertExpectedRequirements(
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

/** Invalid/mismatched browser data is rejected before submission, while releasing the reservation
 * is still safe. The signature itself is never retained after this check. */
function parseAndValidateSignedHeader(
  header: string,
  requirements: PaymentRequirements,
  sessionAddress: string,
): SignedHeaderBody {
  let body: SignedHeaderBody;
  try {
    body = JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as SignedHeaderBody;
  } catch {
    throw new Error("browser returned an invalid payment header");
  }
  const auth = body?.authorization;
  if (!auth || typeof body.signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(body.signature)) {
    throw new Error("browser returned an incomplete payment authorization");
  }
  if (!sameAddress(auth.from ?? "", sessionAddress)) throw new Error("payment authorization signer does not match the session");
  if (!sameAddress(auth.to ?? "", requirements.payTo)) throw new Error("payment authorization payTo does not match the challenge");
  if (String(auth.value) !== requirements.amount) throw new Error("payment authorization amount does not match the challenge");
  if (!/^0x[0-9a-f]{64}$/i.test(auth.nonce ?? "")) throw new Error("payment authorization nonce is invalid");
  if (!/^\d+$/.test(String(auth.validAfter)) || !/^\d+$/.test(String(auth.validBefore))) {
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
    throw new Error("payment authorization validity window does not match the challenge");
  }
  return body;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
