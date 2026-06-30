/**
 * Notify-on-citation webhook dispatcher.
 *
 * When the agent cites a source and settles its weighted citation reward, Keryx POSTs a signed
 * JSON payload to the creator's registered webhook URL — so their own agent/system is pinged the
 * instant it earns, instead of polling the dashboard. Delivery is best-effort and fire-and-forget:
 * a slow or failing endpoint must never stall or fail the agent run (the answer is already written).
 *
 * Authenticity: each delivery carries `X-Keryx-Signature: sha256=<hmac>` computed over the exact
 * request body with the source's per-source secret (HMAC-SHA256). The creator verifies it the same
 * way GitHub/Stripe webhooks are verified — recompute and constant-time compare.
 */

import crypto from "node:crypto";
import type { KeryxDB } from "../db";
import type { Citation, PaymentRecord, Source } from "../types";

/** Outbound POST timeout. A creator's endpoint shouldn't be able to slow the agent for long. */
const TIMEOUT_MS = Math.max(
  1000,
  Math.round(Number(process.env.KERYX_WEBHOOK_TIMEOUT_MS) || 4000),
);

export const CITATION_EVENT = "citation.paid";

/** The signed JSON body delivered to a creator's webhook on a paid citation. */
export interface CitationWebhookPayload {
  event: typeof CITATION_EVENT;
  deliveryId: string;
  timestamp: string;
  source: { id: string; name: string };
  query: { id: string; question: string };
  /** Contribution weight of this source to the answer (0..1). */
  weight: number;
  /** Total USDC settled to this source for the citation (summed across author splits). */
  amountUsdc: number;
  network: string;
  /** Per-author settlement legs, each with its real on-chain settlement state. */
  payments: { payee: string; amountUsdc: number; txHash: string | null; settled: boolean }[];
}

/** A fresh 32-byte hex secret for signing a source's webhook deliveries. */
export function randomNotifySecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** `sha256=<hex>` HMAC of the raw body under `secret` — the value of X-Keryx-Signature. */
export function signWebhook(secret: string, rawBody: string): string {
  const mac = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${mac}`;
}

/** Only deliver to absolute http(s) URLs — blocks empty/relative/non-web schemes defensively. */
export function isDeliverableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Assemble the citation payload from a settled citation and its author payment legs. */
export function buildCitationPayload(input: {
  source: Source;
  citation: Citation;
  payments: PaymentRecord[];
  queryId: string;
  question: string;
  network: string;
}): CitationWebhookPayload {
  const amountUsdc = input.payments.reduce((s, p) => s + p.amountUsdc, 0);
  return {
    event: CITATION_EVENT,
    deliveryId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: { id: input.source.id, name: input.source.name },
    query: { id: input.queryId, question: input.question },
    weight: input.citation.weight,
    amountUsdc,
    network: input.network,
    payments: input.payments.map((p) => ({
      payee: p.payee,
      amountUsdc: p.amountUsdc,
      txHash: p.txHash ?? null,
      settled: p.settled,
    })),
  };
}

/**
 * Look up the source's webhook, sign, and POST the citation payload. Best-effort: returns a promise
 * that always resolves (never rejects) so the caller can fire-and-forget without a floating throw.
 * Resolves `true` only when the endpoint answered 2xx.
 */
export async function dispatchCitationNotify(
  db: KeryxDB,
  input: {
    source: Source;
    citation: Citation;
    payments: PaymentRecord[];
    queryId: string;
    question: string;
    network: string;
  },
): Promise<boolean> {
  try {
    const notify = await db.getSourceNotify(input.source.id);
    if (!notify?.url || !isDeliverableUrl(notify.url)) return false;
    // Only ping on real, settled payouts — a simulated/offline leg isn't an earning event.
    if (!input.payments.some((p) => p.settled)) return false;

    const payload = buildCitationPayload(input);
    const body = JSON.stringify(payload);
    const signature = signWebhook(notify.secret, body);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(notify.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Keryx-Webhook/1",
          "X-Keryx-Event": CITATION_EVENT,
          "X-Keryx-Delivery": payload.deliveryId,
          "X-Keryx-Signature": signature,
        },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.warn(`[notify] ${input.source.id} → ${res.status} from webhook`);
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Network error, abort/timeout, or DNS — the answer + settlement stand regardless.
    console.warn(`[notify] ${input.source.id} webhook failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}
