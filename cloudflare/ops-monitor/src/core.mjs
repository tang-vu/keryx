export const HEALTH_URL = "https://keryx.cc/api/health";
export const DRILL_UNAVAILABLE_URL = "https://keryx.cc/api/keryx-ops-monitor-drill-unavailable";
export const SLOT_MS = 300_000;
export const TIMEOUT_MS = 8_000;
const BODY_LIMIT = 32_768;
const REASONS = new Set(["healthy", "unreachable", "http", "payload", "degraded", "stale"]);

export function initialState() {
  return { version: 2, slot: -1, failures: 0, successes: 0, incident: false, incidentSequence: 0,
    reason: "healthy", checkedAt: null, notices: [], consumed: false };
}

export function validateState(value) {
  const stateKeys = ["version", "slot", "failures", "successes", "incident", "incidentSequence", "reason", "checkedAt", "notices", "consumed"];
  if (!value || value.version !== 2 || !Number.isSafeInteger(value.slot) || value.slot < -1 ||
      !Number.isInteger(value.failures) || value.failures < 0 || value.failures > 3 ||
      !Number.isInteger(value.successes) || value.successes < 0 || value.successes > 2 ||
      typeof value.incident !== "boolean" || typeof value.consumed !== "boolean" ||
      !Number.isSafeInteger(value.incidentSequence) || value.incidentSequence < 0 ||
      !REASONS.has(value.reason) ||
      !(value.checkedAt === null || (Number.isSafeInteger(value.checkedAt) && value.checkedAt >= 0)) ||
      Object.keys(value).length !== stateKeys.length || Object.keys(value).some(key => !stateKeys.includes(key)) ||
      !Array.isArray(value.notices) || value.notices.length > 2 ||
      (value.notices.length > 0 && value.incidentSequence === 0) ||
      new Set(value.notices.map(n => n?.id)).size !== value.notices.length ||
      value.notices.some(n => !validNotice(n, value.incidentSequence))) {
    throw new Error("Monitor state invalid; operator inspection required");
  }
  return value;
}

function validNotice(notice, sequence) {
  const keys = ["kind", "id", "delivery", "attempts", "nextAttemptAt"];
  return notice && Object.keys(notice).length === keys.length &&
    Object.keys(notice).every(key => keys.includes(key)) && ["outage", "recovery"].includes(notice.kind) &&
    notice.id === `incident-${sequence}-${notice.kind}` &&
    ["pending", "attempted", "confirmed", "unconfirmed", "disabled"].includes(notice.delivery) &&
    Number.isInteger(notice.attempts) && notice.attempts >= 0 && notice.attempts <= 3 &&
    (notice.attempts === 0 ? notice.nextAttemptAt === null && ["pending", "disabled"].includes(notice.delivery)
      : Number.isSafeInteger(notice.nextAttemptAt) && notice.nextAttemptAt >= 0 && notice.delivery !== "pending");
}

function newNotice(kind, sequence) {
  return { kind, id: `incident-${sequence}-${kind}`, delivery: "pending", attempts: 0, nextAttemptAt: null };
}

export function advance(previous, reason, now) {
  validateState(previous);
  if (!REASONS.has(reason)) throw new Error("Invalid probe reason");
  const state = structuredClone(previous);
  state.reason = reason;
  state.checkedAt = now;
  if (reason === "healthy") {
    state.failures = 0;
    state.successes = Math.min(2, state.successes + 1);
    if (state.incident && state.successes === 2) {
      state.incident = false;
      state.notices.push(newNotice("recovery", state.incidentSequence));
    }
  } else {
    state.successes = 0;
    state.failures = Math.min(3, state.failures + 1);
    if (!state.incident && state.failures === 3) {
      state.incident = true;
      if (state.incidentSequence === Number.MAX_SAFE_INTEGER) throw new Error("Incident sequence exhausted");
      state.incidentSequence++;
      // Keep only the current incident, never an unbounded history.
      state.notices = [newNotice("outage", state.incidentSequence)];
    }
  }
  return state;
}

async function limitedJson(response) {
  if (!response.body) throw new Error("No payload");
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BODY_LIMIT) throw new Error("Payload exceeds bound");
      chunks.push(value);
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(combined));
  } finally { await reader.cancel().catch(() => {}); }
}

export function probe(fetcher = fetch, now = Date.now()) {
  return probeUrl(HEALTH_URL, fetcher, now);
}

export function probeUnavailable(fetcher = fetch, now = Date.now()) {
  return probeUrl(DRILL_UNAVAILABLE_URL, fetcher, now, 404);
}

async function probeUrl(url, fetcher, now, expectedUnavailableStatus) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "GET", redirect: "manual", signal: controller.signal,
      headers: { "Cache-Control": "no-cache", Accept: "application/json" },
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return expectedUnavailableStatus && response.status !== expectedUnavailableStatus ? "payload" : "http";
    }
    let payload;
    try { payload = await limitedJson(response); } catch { return "payload"; }
    if (!payload || payload.name !== "keryx" || payload.ok !== true || payload.db !== "ok" ||
        !["operational", "degraded"].includes(payload.status) || typeof payload.time !== "string") return "payload";
    const timestamp = Date.parse(payload.time);
    if (!Number.isFinite(timestamp) || timestamp > now + 60_000 || timestamp < now - 120_000) return "stale";
    return payload.status === "operational" ? "healthy" : "degraded";
  } catch { return "unreachable"; }
  finally { clearTimeout(timer); }
}

export function noticeText(notice, diagnostic, runId) {
  const prefix = diagnostic ? `[DRILL] ${runId} ` : "";
  const message = notice.kind === "outage"
    ? `${prefix}Keryx health incident: three consecutive failed checks. Inspect https://keryx.cc/status and the incident runbook. No payment or job action was taken.`
    : `${prefix}Keryx health recovered: two consecutive healthy checks. This confirms endpoint readiness only; review outstanding incidents separately.`;
  return `${message} Notice ${notice.id}. Delivery may repeat when an acknowledgement is lost (maximum three attempts).`;
}

export async function notify(env, notice, diagnostic, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(`https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.ALERT_TELEGRAM_CHAT_ID,
        text: noticeText(notice, diagnostic, env.DIAGNOSTIC_RUN_ID), disable_web_page_preview: true }),
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return "unconfirmed";
    }
    const result = await limitedJson(response);
    return result?.ok === true && Number.isSafeInteger(result.result?.message_id) && result.result.message_id > 0 &&
      Number.isSafeInteger(result.result?.chat?.id) && String(result.result.chat.id) === env.ALERT_TELEGRAM_CHAT_ID
      ? "confirmed" : "unconfirmed";
  } catch { return "unconfirmed"; }
  finally { clearTimeout(timer); }
}
