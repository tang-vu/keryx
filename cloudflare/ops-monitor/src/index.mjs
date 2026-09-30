import { advance, initialState, notify, probe, probeUnavailable, SLOT_MS, validateState } from "./core.mjs";

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
  let timer;
  try {
    return await Promise.race([
      reader.read().then(result => result.done),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 5_000); }),
    ]);
  } catch { return false; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
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
  constructor(state, env) { this.state = state; this.env = env; this.queue = Promise.resolve(); }
  async fetch(request) {
    // Serialize this object's requests without blockConcurrencyWhile's 30s callback
    // limit. Durable claims/attempt counts survive process loss; the queue only orders I/O.
    const operation = this.queue.then(async () => {
      try {
        const url = new URL(request.url);
        let state = validateState(await this.state.storage.get("state") ?? initialState());
        if (url.pathname === "/status") return Response.json(state, { headers: { "Cache-Control": "no-store" } });
        if (url.pathname === "/diagnostic") {
          if (state.consumed) {
            await this.deliver(state, true);
            return Response.json({ status: "already_consumed", state });
          }
          // Consume before execution: uncertainty never admits a second fixture run.
          state.consumed = true;
          await this.state.storage.put("state", state);
          const control = await probe();
          if (control !== "healthy") return Response.json({ status: "control_failed", reason: control, state }, { status: 503 });
          for (let step = 0; step < 5; step++) {
            const now = Date.now();
            const reason = step < 3 ? await probeUnavailable() : await probe();
            // The unavailable route must be exactly 404; actual health must be ready.
            if (reason !== (step < 3 ? "http" : "healthy")) {
              return Response.json({ status: "fixture_failed", step, reason, state }, { status: 503 });
            }
            state = advance(state, reason, now);
            await this.state.storage.put("state", state);
            await this.deliver(state, true);
          }
          return Response.json({ status: "completed", control, fixture: "external-http-404-then-healthy", state });
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
        // Claim before I/O. A crash consumes the sample; persisted notices retry separately.
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
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
  async deliver(state, diagnostic) {
    for (const notice of state.notices) {
      const now = Date.now();
      if (["confirmed", "disabled"].includes(notice.delivery) || notice.attempts >= 3 ||
          (notice.nextAttemptAt !== null && notice.nextAttemptAt > now)) continue;
      if (diagnostic && this.env.DIAGNOSTIC_NOTIFICATIONS_ENABLED !== "true") {
        notice.delivery = "disabled";
        await this.state.storage.put("state", state);
        continue;
      }
      // Persist bounded retry count/deadline BEFORE I/O. A crash or lost ACK may
      // repeat a stable notice ID, but never immediately or more than three times.
      notice.delivery = "attempted";
      notice.attempts++;
      notice.nextAttemptAt = now + SLOT_MS;
      await this.state.storage.put("state", state);
      notice.delivery = await notify(this.env, notice, diagnostic);
      await this.state.storage.put("state", state);
    }
  }
}
