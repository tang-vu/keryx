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
import { canSpend, getGrant, isGrantValid, recordSpend } from "./session-grants";

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

/**
 * Called by the SSE route to emit a `sign-request` event to the browser and
 * return a promise that resolves when the browser posts the signed header.
 * This function is injected so the gateway has no direct coupling to the SSE
 * controller — keeps the gateway testable.
 */
export type RequestSignatureFn = (
  reqId: string,
  requirements: PaymentRequirements,
) => Promise<string>;

export class BrowserCoSignGateway implements PaymentGateway {
  readonly mode = "real" as const;

  constructor(
    private readonly sessionId: string,
    private readonly requestSignature: RequestSignatureFn,
    private readonly abortSignal?: AbortSignal,
  ) {}

  agentAddress(): string {
    const grant = getGrant(this.sessionId);
    return grant?.sessAddr ?? "0xSESSION";
  }

  async ensureFunded(_budget: number): Promise<{ address: string }> {
    // The user already funded the session EOA and deposited into the Gateway
    // as part of the grant flow (grant POST verified the balance). No-op here.
    const grant = getGrant(this.sessionId);
    return { address: grant?.sessAddr ?? "0xSESSION" };
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

    if (!isGrantValid(this.sessionId)) {
      throw new Error("session grant expired or revoked — aborting spend");
    }

    // Pre-spend cap guard: enforce before requesting a signature so the browser
    // never signs an authorization the grant can't cover.
    if (!canSpend(this.sessionId, amount)) {
      throw new Error(`session cap would be exceeded (amount=${amount})`);
    }

    // Step 1: hit the URL without a payment header to obtain the 402 challenge.
    // The challenge MUST be requested with the same method the paid retry will use:
    // /api/source is GET, but /api/cite is POST-only (a GET there returns 405, not 402).
    const reqId = crypto.randomUUID();
    const method = kind === "fetch" ? "GET" : "POST";
    const requirements = await this.fetchRequirements(url, method);

    // Step 2: Ask the browser to sign. The browser validates payTo/amount against
    // the grant cap before signing — defence against a compromised server sending
    // inflated amounts. The server enforces the pre-spend guard above as a second layer.
    let paymentHeader: string;
    try {
      paymentHeader = await this.requestSignature(reqId, requirements);
    } catch (err) {
      // Timeout or revoke — record a skipped payment rather than crashing the run.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`sign-request failed (${message}) — skipping ${source.name}`);
    }

    // Step 3: Retry with the signed header — triggers verify+settle server-side.
    const grant = getGrant(this.sessionId);
    const payer = grant?.sessAddr ?? "0xSESSION";

    const retryRes = await fetch(url, {
      method,
      headers: {
        "payment-signature": paymentHeader,
        Accept: "application/json",
      },
      signal: this.abortSignal,
    });

    if (!retryRes.ok) {
      const body = await retryRes.text().catch(() => "");
      throw new Error(`source fetch failed after payment: ${retryRes.status} ${body.slice(0, 120)}`);
    }

    // Step 4: Record the spend in the server grant tracker.
    recordSpend(this.sessionId, amount);

    // Step 5: Extract the settled tx from the response header, if present.
    const paymentResponse = retryRes.headers.get("PAYMENT-RESPONSE");
    let txHash: string | null = null;
    if (paymentResponse) {
      try {
        const parsed = JSON.parse(Buffer.from(paymentResponse, "base64").toString("utf-8"));
        txHash = parsed.transaction ?? null;
      } catch { /* non-critical */ }
    }

    const bodyJson = await retryRes.json().catch(() => ({})) as Record<string, unknown>;
    const content = (bodyJson.content as string) ?? (bodyJson.text as string) ?? JSON.stringify(bodyJson);

    const payment = makePayment({
      kind,
      queryId,
      sourceId: source.id,
      sourceName: source.name,
      payer,
      payee: author?.walletAddress ?? source.walletAddress,
      amountUsdc: amount,
      weight,
      txHash,
      settled: txHash !== null,
      rationale: rationale ?? "Browser co-sign toll settled on Arc via x402.",
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
