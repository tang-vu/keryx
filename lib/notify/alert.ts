/**
 * Ops alert channel — a single fire-and-forget notifier for operational events the operator needs
 * to know about out-of-band (treasury running low, a citation reward that failed to settle).
 *
 * Delivery is best-effort: it POSTs to `KERYX_ALERT_WEBHOOK` when set (a Discord or Slack incoming
 * webhook — the body carries both `content` and `text` so either accepts it), and ALWAYS logs to
 * the process output so the signal is visible in `pm2 logs` even with no webhook configured. It
 * never throws, so an alert can be `void`-fired from any hot path without risking the caller.
 */

const WEBHOOK = (process.env.KERYX_ALERT_WEBHOOK ?? "").trim();
const TIMEOUT_MS = 4000;

/** Post an operational alert. Returns true only when a webhook was configured and answered 2xx. */
export async function sendAlert(title: string, detail?: string): Promise<boolean> {
  const line = detail ? `${title} — ${detail}` : title;
  console.warn(`[alert] ${line}`);
  if (!WEBHOOK) return false;

  const text = detail ? `⚠️ Keryx: ${title}\n${detail}` : `⚠️ Keryx: ${title}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, text }),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false; // network/abort — the log line above is still the durable record.
  } finally {
    clearTimeout(timer);
  }
}
