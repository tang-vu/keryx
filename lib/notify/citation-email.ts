/**
 * Citation email alerts — the human channel beside the citation webhook.
 *
 * The webhook (citation-webhook.ts) closes the creator loop for creators who run software; most
 * writers don't. When a source with an owner-set alert email earns a settled citation reward,
 * Keryx sends a short "you were cited and paid" email instead. Same contract as the webhook:
 * best-effort, fire-and-forget, never throws, never stalls the agent run.
 *
 * Delivery is via Resend's HTTP API (one POST, no SDK). The feature ships dark: with no
 * KERYX_RESEND_API_KEY + KERYX_EMAIL_FROM the dispatcher no-ops, and the settings panel says so.
 * A per-source rate cap (default 60 min) keeps repeat citations from
 * flooding an inbox — the earnings page still shows every payout it skipped.
 */

import crypto from "node:crypto";
import type { KeryxDB } from "../db";
import type { Citation, PaymentRecord, Source } from "../types";
import { buildCitationPayload, type CitationWebhookPayload } from "./citation-webhook";
import { readRecipientLanguage } from "./recipient-language";
import { citationEmailMessages } from "./citation-messages";
import { presentationLanguage, type PresentationLanguage } from "../research/presentation-language";

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 5000;

/** True when the deployment can actually deliver mail (provider key + from address set). */
export function emailNotifyConfigured(): boolean {
  return Boolean(process.env.KERYX_RESEND_API_KEY && process.env.KERYX_EMAIL_FROM);
}

/** Minimum gap between two mails for one source. Env override in minutes, default 60. */
export function emailMinIntervalMs(): number {
  const min = Number(process.env.KERYX_EMAIL_MIN_INTERVAL_MIN);
  return (Number.isFinite(min) && min >= 0 ? min : 60) * 60_000;
}

/** Light shape check — the real validation is that mail to it arrives. Caps abuse-length input. */
export function isValidAlertEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** A fresh 32-byte hex token for a source's unauthenticated unsubscribe link. */
export function randomUnsubToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Rate cap: send when there is no prior delivery or the interval has fully elapsed. */
export function shouldSendEmail(
  lastSentAt: string | null,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  if (!lastSentAt) return true;
  const last = Date.parse(lastSentAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= minIntervalMs;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Subject + HTML + text bodies for one settled citation. Pure, so the content is testable. */
export function buildCitationEmailContent(
  payload: CitationWebhookPayload,
  opts: { base: string; unsubToken: string; language?: PresentationLanguage },
): { subject: string; html: string; text: string } {
  const copy = citationEmailMessages[presentationLanguage(opts.language) ?? "en"];
  const amount = `$${payload.amountUsdc.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  const weightPct = `${Math.round(payload.weight * 100)}%`;
  const creatorUrl = `${opts.base}/creator/${payload.source.id}`;
  const dispatchUrl = `${opts.base}/dispatch/${payload.query.id}`;
  const unsubUrl = `${opts.base}/api/notify/unsubscribe?sid=${payload.source.id}&t=${opts.unsubToken}`;

  const values = { sourceName: payload.source.name, amount, weightPct, network: payload.network };
  // Only catalogue placeholders are replaced, once; source text cannot introduce more slots.
  const render = (template: string, html = false): string => {
    const wrapper = html
      ? escapeHtml(template).replace(/—/g, "&mdash;").replace(/·/g, "&middot;")
      : template;
    return wrapper.replace(/\{(sourceName|amount|weightPct|network)\}/g,
      (_match, key: keyof typeof values) => html ? escapeHtml(values[key]) : values[key]);
  };
  const subject = render(copy.subject);

  const text = [
    render(copy.textBody),
    ...(payload.article ? [`${copy.article}: ${payload.article.itemTitle}`] : []),
    ``,
    `${copy.trace}: ${dispatchUrl}`,
    `${copy.earnings}:  ${creatorUrl}`,
    ``,
    copy.textRate,
    `${copy.stop}: ${unsubUrl}`,
  ].join("\n");

  const html = `
<div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#faf6ec;color:#211d16;font-family:Georgia,'Times New Roman',serif;border:1px solid #d8cfb8;">
  <p style="margin:0 0 4px;font-family:monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8c2f24;">${render(copy.htmlTitle, true)}</p>
  <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">${render(copy.htmlHeading, true)}</h1>
  ${payload.article ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;"><strong>${escapeHtml(copy.article)}:</strong> ${escapeHtml(payload.article.itemTitle)}</p>` : ""}
  <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">${render(copy.htmlBody, true)}</p>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.6;">
    <a href="${escapeHtml(dispatchUrl)}" style="color:#8c2f24;">${escapeHtml(copy.traceLink)}</a> &middot;
    <a href="${escapeHtml(creatorUrl)}" style="color:#8c2f24;">${escapeHtml(copy.earningsLink)}</a>
  </p>
  <p style="margin:0;padding-top:14px;border-top:1px solid #d8cfb8;font-size:12px;color:#6b6151;line-height:1.6;">
    ${render(copy.htmlRate, true)}
    <a href="${escapeHtml(unsubUrl)}" style="color:#6b6151;">${escapeHtml(copy.unsubscribe)}</a>
  </p>
</div>`.trim();

  return { subject, html, text };
}

/**
 * Look up the source's alert email, rate-cap, build, and send. Best-effort: always resolves,
 * `true` only when the provider accepted the mail. Mirrors dispatchCitationNotify's contract.
 */
export async function dispatchCitationEmail(
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
    if (!emailNotifyConfigured()) return false;
    const notify = await db.getSourceNotifyEmail(input.source.id);
    if (!notify?.email || !isValidAlertEmail(notify.email)) return false;
    // Only mail on real, settled payouts — a simulated/offline leg isn't an earning event.
    if (!input.payments.some((p) => p.settled)) return false;
    if (!shouldSendEmail(notify.lastSentAt, Date.now(), emailMinIntervalMs())) return false;

    const payload = buildCitationPayload(input);
    const base = process.env.BASE_URL || "https://keryx.cc";
    const { subject, html, text } = buildCitationEmailContent(payload, {
      base,
      unsubToken: notify.unsubToken,
      language: (await readRecipientLanguage(db, { sourceId: input.source.id, email: notify.email, unsubToken: notify.unsubToken })).language,
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KERYX_RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.KERYX_EMAIL_FROM,
          to: [notify.email],
          subject,
          html,
          text,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.warn(`[notify-email] ${input.source.id} → ${res.status} from provider`);
        return false;
      }
      // Mark AFTER acceptance so a failed send doesn't burn the rate window.
      await db.markSourceNotifyEmailSent(input.source.id, new Date().toISOString());
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Provider outage, abort/timeout, or DNS — the answer + settlement stand regardless.
    console.warn(
      `[notify-email] ${input.source.id} failed:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
