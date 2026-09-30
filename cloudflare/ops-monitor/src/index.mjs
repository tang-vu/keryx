import { advance, initialState, notify, probe, SLOT_MS, validateState } from "./core.mjs";

function configured(env) {
  return typeof env.MONITOR_DIAGNOSTIC_TOKEN === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(env.MONITOR_DIAGNOSTIC_TOKEN) &&
    typeof env.ALERT_TELEGRAM_BOT_TOKEN === "string" && /^\d+:[A-Za-z0-9_-]{20,}$/.test(env.ALERT_TELEGRAM_BOT_TOKEN) &&
    typeof env.ALERT_TELEGRAM_CHAT_ID === "string" && /^-?\d+$/.test(env.ALERT_TELEGRAM_CHAT_ID) &&
    typeof env.DIAGNOSTIC_RUN_ID === "string" && /^[a-zA-Z0-9-]{1,40}$/.test(env.DIAGNOSTIC_RUN_ID) &&
    ["true", "false"].includes(env.DIAGNOSTIC_NOTIFICATIONS_ENABLED);
}

async function authenticated(request, env) {
  const supplied = request.headers.get("authorization") ?? "";
  if (supplied.length > 256) return false;
  const encode = value => new TextEncoder().encode(value);
  const key = await crypto.subtle.importKey("raw", encode(env.MONITOR_DIAGNOSTIC_TOKEN),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const expected = await crypto.subtle.sign("HMAC", key, encode(`Bearer ${env.MONITOR_DIAGNOSTIC_TOKEN}`));
  return crypto.subtle.verify("HMAC", key, expected, encode(supplied));
}

function object(env, diagnostic = false) {
  const name = diagnostic ? `diagnostic-${env.DIAGNOSTIC_RUN_ID}` : "production-v1";
  return env.MONITOR.get(env.MONITOR.idFromName(name));
}

async function emptyBody(request) {
  if (request.body === null) return true;
  const reader = request.body.getReader();
  try { return (await reader.read()).done; }
  finally { await reader.cancel().catch(() => {}); }
}

export default {
  async scheduled(event, env) {
    if (!configured(env)) throw new Error("Monitor configuration unavailable");
    const response = await object(env).fetch("https://internal.invalid/probe", {
      method: "POST", headers: { "X-Scheduled-Time": String(event.scheduledTime) },
    });
    if (!response.ok) throw new Error("Monitor invocation failed; inspect authenticated status");
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.search || !["/probe", "/diagnostic", "/status"].includes(url.pathname) ||
        request.method !== (url.pathname === "/status" ? "GET" : "POST") ||
        !configured(env) || !(await authenticated(request, env)) || !(await emptyBody(request))) {
      return new Response(null, { status: 404 });
    }
    return object(env, url.pathname === "/diagnostic").fetch(`https://internal.invalid${url.pathname}`, {
      method: request.method,
    });
  },
};

export class MonitorState {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    // Includes all async storage/network work: overlapping Cron/operator calls cannot race.
    return this.state.blockConcurrencyWhile(async () => {
      try {
        const url = new URL(request.url);
        let state = validateState(await this.state.storage.get("state") ?? initialState());
        if (url.pathname === "/status") return Response.json(state, { headers: { "Cache-Control": "no-store" } });
        if (url.pathname === "/diagnostic") {
          if (state.consumed) return Response.json({ status: "already_consumed", state });
          // Consume before execution: uncertainty never admits a second fixture run.
          state.consumed = true;
          await this.state.storage.put("state", state);
          for (let step = 0; step < 5; step++) {
            const now = Date.now();
            const fixture = async () => step < 3
              ? new Response(null, { status: 503 })
              : Response.json({ name: "keryx", ok: true, db: "ok", status: "operational", time: new Date(now).toISOString() });
            state = advance(state, await probe(fixture, now), now);
            await this.state.storage.put("state", state);
            await this.deliver(state, true);
          }
          return Response.json({ status: "completed", fixture: "http-503-then-healthy", state });
        }
        if (url.pathname !== "/probe") return new Response(null, { status: 404 });
        const now = Date.now();
        const scheduled = request.headers.get("X-Scheduled-Time");
        const sampleTime = scheduled === null ? now : Number(scheduled);
        if (!Number.isSafeInteger(sampleTime) || sampleTime > now + 60_000 || sampleTime < now - SLOT_MS) {
          return Response.json({ status: "invalid_slot" }, { status: 400 });
        }
        const slot = Math.floor(sampleTime / SLOT_MS);
        if (slot <= state.slot) return Response.json({ status: "already_claimed" });
        // Claim before I/O. A crash consumes this sample, never duplicates a notification.
        state.slot = slot;
        await this.state.storage.put("state", state);
        // Missed slots break consecutive observations instead of compressing a long outage.
        if (state.checkedAt !== null && now - state.checkedAt > SLOT_MS * 2) {
          state.failures = 0; state.successes = 0;
        }
        state = advance(state, await probe(fetch, now), now);
        await this.state.storage.put("state", state);
        await this.deliver(state, false);
        return Response.json({ status: "completed", reason: state.reason });
      } catch {
        return Response.json({ status: "inspection_required" }, { status: 503 });
      }
    });
  }
  async deliver(state, diagnostic) {
    for (const notice of state.notices) {
      if (notice.delivery !== "pending") continue;
      if (diagnostic && this.env.DIAGNOSTIC_NOTIFICATIONS_ENABLED !== "true") {
        notice.delivery = "disabled";
        await this.state.storage.put("state", state);
        continue;
      }
      // Telegram has no sendMessage idempotency key. Persist intent BEFORE sending;
      // a lost acknowledgement stays attempted/unconfirmed and is never auto-replayed.
      notice.delivery = "attempted";
      await this.state.storage.put("state", state);
      notice.delivery = await notify(this.env, notice, diagnostic);
      await this.state.storage.put("state", state);
    }
  }
}
