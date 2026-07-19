/**
 * HMAC-SHA256 request-signature check for Slack slash commands.
 *
 * Slack signs every request: the `X-Slack-Signature` header is `v0=` + the hex HMAC-SHA256 of the
 * basestring `v0:{X-Slack-Request-Timestamp}:{rawBody}`, keyed by the app's Signing Secret. The
 * signature covers the RAW request bytes, so the route must verify before parsing the form body.
 *
 * The timestamp is checked first: anything more than five minutes from now is rejected outright,
 * which turns a captured-and-replayed request into a stale one. Only then is the digest compared,
 * constant-time, so a wrong signature can't be probed byte by byte. Never throws — a malformed
 * timestamp, secret, or signature is just a `false`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// Slack's own recommended replay window: reject requests whose timestamp is >5 min off.
const MAX_SKEW_SECONDS = 60 * 5;
const VERSION = "v0";

/** True only when `signature` is a fresh, valid Slack signature over the raw body. Never throws. */
export function verifyRequestSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  rawBody: string,
): boolean {
  try {
    const ts = Number(timestamp);
    // Number("") is 0, Number("abc") is NaN — both fail here (0 is >5 min from any real clock).
    if (!Number.isFinite(ts)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;

    const expected =
      `${VERSION}=` +
      createHmac("sha256", signingSecret).update(`${VERSION}:${timestamp}:${rawBody}`).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
