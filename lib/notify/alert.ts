/** Best-effort operational alerts. Configuration is captured at process startup.
 * Every configured channel must acknowledge delivery before the caller can mark it sent.
 * Process logs are observations, not delivery acknowledgements. Transport failures never throw.
 */
const WEBHOOK = (process.env.KERYX_ALERT_WEBHOOK ?? "").trim();
const TELEGRAM_TOKEN = (process.env.KERYX_ALERT_TELEGRAM_BOT_TOKEN ?? "").trim();
const TELEGRAM_CHAT = (process.env.KERYX_ALERT_TELEGRAM_CHAT_ID ?? "").trim();
const TIMEOUT_MS = 4000;
const telegramRequested = Boolean(TELEGRAM_TOKEN || TELEGRAM_CHAT);
const telegramConfigured = /^\d+:[A-Za-z0-9_-]+$/.test(TELEGRAM_TOKEN) &&
  (/^-?[1-9]\d*$/.test(TELEGRAM_CHAT) || /^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(TELEGRAM_CHAT));

/** Known endpoint credentials must not appear in messages or process logs. */
function redact(value: string): string {
  let safe = value;
  for (const secret of [WEBHOOK, TELEGRAM_TOKEN]) {
    if (secret) safe = safe.replaceAll(secret, "[redacted]");
  }
  return safe.replace(/https?:\/\/api\.telegram\.org\/bot[^\s<>]+/gi, "[redacted Telegram endpoint]");
}

async function post(url: string, body: Record<string, string>, telegram = false): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      // Never forward an endpoint containing a bot credential through a redirect.
      redirect: "error",
    });
    if (!res.ok) return false;
    if (!telegram) return true;
    const acknowledgment: unknown = await res.json();
    return typeof acknowledgment === "object" && acknowledgment !== null &&
      "ok" in acknowledgment && acknowledgment.ok === true;
  } catch {
    // HTTP response bodies and error messages may contain endpoint credentials.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** True only if at least one channel exists, configuration is complete, and all
 * configured channels acknowledge. Partial Telegram config never sends to Telegram.
 * There is no fallback to the public /ask bot or another chat.
 */
export async function sendAlert(title: string, detail?: string): Promise<boolean> {
  const safeTitle = redact(title), safeDetail = detail ? redact(detail) : undefined;
  console.warn(`[alert] ${safeDetail ? `${safeTitle} — ${safeDetail}` : safeTitle}`);
  const text = safeDetail ? `⚠️ Keryx: ${safeTitle}\n${safeDetail}` : `⚠️ Keryx: ${safeTitle}`;
  const deliveries: Promise<boolean>[] = [];
  if (WEBHOOK) deliveries.push(post(WEBHOOK, { content: text, text }));
  if (telegramConfigured) {
    // Telegram accepts up to 4096 characters. Keep a margin and preserve Unicode characters.
    const characters = Array.from(text);
    const bounded = characters.length > 4000 ? `${characters.slice(0, 3999).join("")}…` : text;
    deliveries.push(post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT, text: bounded }, true));
  }
  if (telegramRequested && !telegramConfigured) console.warn("[alert] Telegram ops configuration incomplete or invalid");
  const delivered = await Promise.all(deliveries);
  return !(telegramRequested && !telegramConfigured) && delivered.length > 0 && delivered.every(Boolean);
}
