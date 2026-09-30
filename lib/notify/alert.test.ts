import { afterEach, beforeEach, expect, it, vi } from "vitest";

const token = "123456:synthetic_ops_token", chat = "-1001234567890";
const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
const webhook = "https://synthetic.example/private-webhook";
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("KERYX_ALERT_WEBHOOK", "");
  vi.stubEnv("KERYX_ALERT_TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("KERYX_ALERT_TELEGRAM_CHAT_ID", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "999:synthetic_public_bot");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // An unconfigured test must never reach a real network.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected synthetic fetch")));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const configureTelegram = () => {
  vi.stubEnv("KERYX_ALERT_TELEGRAM_BOT_TOKEN", token);
  vi.stubEnv("KERYX_ALERT_TELEGRAM_CHAT_ID", chat);
};
const load = () => import("./alert");

it("uses only the dedicated bot and exact chat with a plain-text bounded request", async () => {
  configureTelegram();
  const http = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true, result: {} })));
  vi.stubGlobal("fetch", http);
  const { sendAlert } = await load();
  expect(await sendAlert("Treasury <low>", "Synthetic *detail*")).toBe(true);
  expect(http).toHaveBeenCalledOnce();
  const [url, options] = http.mock.calls[0];
  expect(url).toBe(endpoint);
  expect(options).toMatchObject({ method: "POST", redirect: "error", headers: { "Content-Type": "application/json" } });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(options.body)).toEqual({ chat_id: chat, text: "⚠️ Keryx: Treasury <low>\nSynthetic *detail*" });
  expect(await sendAlert("Synthetic long alert", "🧪".repeat(5000))).toBe(true);
  const longText = JSON.parse(http.mock.calls[1][1].body).text;
  expect(Array.from(longText).length).toBe(4000);
  expect(longText.endsWith("…")).toBe(true);
  expect(longText).not.toContain("\uFFFD");
});

it.each([
  { status: 200, body: { ok: false, description: "synthetic refusal" } },
  { status: 200, body: { ok: "true" } },
  { status: 200, body: null },
  { status: 200, body: {} },
  { status: 401, body: { ok: true } },
  { status: 429, body: { ok: false } },
])("requires HTTP success and strict Telegram acknowledgment: $status $body", async ({ status, body }) => {
  configureTelegram();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status })));
  const { sendAlert } = await load();
  expect(await sendAlert("Synthetic incident")).toBe(false);
});

it("contains malformed JSON and network errors without logging transport secrets", async () => {
  configureTelegram();
  const http = vi.fn().mockResolvedValueOnce(new Response("not json"))
    .mockRejectedValueOnce(new Error(`${endpoint} ${token}`));
  vi.stubGlobal("fetch", http);
  const { sendAlert } = await load();
  expect(await sendAlert("Synthetic incident")).toBe(false);
  expect(await sendAlert("Synthetic incident")).toBe(false);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(token);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(endpoint);
});

it.each(["http", "acknowledgment"])("bounds the %s wait and returns failure on abort", async (stage) => {
  vi.useFakeTimers();
  configureTelegram();
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_url, options) => {
    signal = options.signal;
    const wait = () => new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true }));
    return stage === "http" ? wait() : Promise.resolve({ ok: true, json: wait });
  }));
  const { sendAlert } = await load();
  const pending = sendAlert("Synthetic stalled incident");
  await vi.advanceTimersByTimeAsync(3999);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(false);
  expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([{}, { token }, { chat }, { token: "../../synthetic", chat }, { token, chat: "0" }])(
  "fails closed for missing or invalid ops config without public bot fallback: %j", async (configuration) => {
    vi.stubEnv("KERYX_ALERT_TELEGRAM_BOT_TOKEN", configuration.token ?? "");
    vi.stubEnv("KERYX_ALERT_TELEGRAM_CHAT_ID", configuration.chat ?? "");
    const { sendAlert } = await load();
    expect(await sendAlert("Synthetic incident")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("retains webhook-only delivery and requires both configured channels to succeed", async () => {
  vi.stubEnv("KERYX_ALERT_WEBHOOK", webhook);
  const http = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", http);
  expect(await (await load()).sendAlert("Synthetic webhook incident")).toBe(true);
  expect(JSON.parse(http.mock.calls[0][1].body)).toEqual({ content: "⚠️ Keryx: Synthetic webhook incident", text: "⚠️ Keryx: Synthetic webhook incident" });
  configureTelegram();
  vi.resetModules();
  for (const [webhookOk, telegramOk] of [[true, false], [false, true], [true, true]]) {
    http.mockReset().mockImplementation((url) => Promise.resolve(url === webhook
      ? new Response(null, { status: webhookOk ? 204 : 500 }) : Response.json({ ok: telegramOk })));
    const { sendAlert } = await load();
    expect(await sendAlert("Synthetic dual-channel incident")).toBe(webhookOk && telegramOk);
    expect(http.mock.calls.map(([url]) => url).sort()).toEqual([endpoint, webhook].sort());
  }
});

it("attempts the existing webhook but reports failure for a partial Telegram pair", async () => {
  vi.stubEnv("KERYX_ALERT_WEBHOOK", webhook);
  vi.stubEnv("KERYX_ALERT_TELEGRAM_BOT_TOKEN", token);
  const http = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", http);
  expect(await (await load()).sendAlert("Synthetic incomplete config")).toBe(false);
  expect(http).toHaveBeenCalledOnce();
  expect(http.mock.calls[0][0]).toBe(webhook);
});

it("redacts configured credentials and Telegram endpoints from logs and delivered text", async () => {
  configureTelegram();
  vi.stubEnv("KERYX_ALERT_WEBHOOK", webhook);
  const http = vi.fn().mockImplementation((url) => Promise.resolve(url === webhook
    ? new Response(null, { status: 204 }) : Response.json({ ok: true })));
  vi.stubGlobal("fetch", http);
  expect(await (await load()).sendAlert(token, `${endpoint} ${webhook}`)).toBe(true);
  const output = JSON.stringify(vi.mocked(console.warn).mock.calls) + http.mock.calls.map(([, options]) => options.body).join();
  expect(output).not.toContain(token);
  expect(output).not.toContain(endpoint);
  expect(output).not.toContain(webhook);
  expect(output).toContain("[redacted]");
});
