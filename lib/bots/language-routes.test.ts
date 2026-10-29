import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { botControlsCatalogues, botPreferenceKey } from "./language";
import { botResearchMessages } from "./research-messages";
import type { QueryRun } from "../types";

const mocks = vi.hoisted(() => ({ db: vi.fn(), collect: vi.fn(), admission: vi.fn(),
  after: [] as (() => Promise<unknown>)[], config: { baseUrl: "https://bot-controls.example", defaultBudget: 0.05,
    anonMaxBudget: 0.025, sellerAddress: "isolated-treasury", telegramBotToken: "isolated-token",
    telegramWebhookSecret: "isolated-webhook-secret", slackSigningSecret: "isolated-signing-secret", discordPublicKey: "" } }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(),
  after: (fn: () => Promise<unknown>) => mocks.after.push(fn) }));
vi.mock("@/lib/config", () => ({ config: mocks.config }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collect }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.admission }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ prepareHostedRunClaim: async () => null, hostedRunClaimsEnabled: () => false }));
import { POST as telegram } from "../../app/api/telegram/webhook/route";
import { POST as discord } from "../../app/api/discord/interactions/route";
import { POST as slack } from "../../app/api/slack/commands/route";

type Platform = "telegram" | "discord" | "slack";
const handlers = { telegram, discord, slack }, platforms: Platform[] = ["telegram", "discord", "slack"];
// Ephemeral local keys sign fixture bytes through the real existing verifier; no bot credentials or transport.
const keys = generateKeyPairSync("ed25519");
const state = new Map<string, string>();
const db = { getSyncState: vi.fn(async (key: string) => state.get(key) ?? null),
  setSyncState: vi.fn(async (key: string, value: string) => { state.set(key, value); }) };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.clear(); vi.clearAllMocks(); mocks.after.length = 0;
  mocks.config.discordPublicKey = keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  mocks.db.mockResolvedValue(db); mocks.admission.mockResolvedValue(null);
  mocks.collect.mockRejectedValue(new Error("Research is not a control operation"));
  fetchMock = vi.fn(async () => { throw new Error("Outbound delivery forbidden in control test"); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function request(platform: Platform, action: "help" | "language" | "ask", value?: string,
  options: { scope?: string; user?: string; platformLocale?: string; group?: boolean; bot?: boolean } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = platform === "telegram" ? JSON.stringify({ message: { text: `/${action}${value ? ` ${value}` : ""}`,
    chat: { id: options.group ? -123 : 789, type: options.group ? "group" : "private" },
    from: { id: 789, is_bot: options.bot ?? false, language_code: options.platformLocale } } })
    : platform === "discord" ? JSON.stringify({ type: 2, application_id: options.scope ?? "123", token: "isolated-interaction",
      locale: options.platformLocale, member: { user: { id: options.user ?? "789" } },
      data: { name: action, options: value ? [{ name: action === "language" ? "value" : action === "help" ? "language" : "question", value }] : [] } })
    : new URLSearchParams({ command: "/keryx", text: action === "help" && !value ? "" : action === "ask" ? value ?? "" : `/${action} ${value ?? ""}`,
      team_id: options.scope ?? "T123", user_id: options.user ?? "U789", response_url: "https://hooks.slack.com/commands/isolated/private" }).toString();
  const headers: Record<string, string> = platform === "telegram" ? { "x-telegram-bot-api-secret-token": mocks.config.telegramWebhookSecret }
    : platform === "discord" ? { "x-signature-timestamp": timestamp, "x-signature-ed25519": sign(null, Buffer.from(timestamp + body), keys.privateKey).toString("hex") }
    : { "x-slack-request-timestamp": timestamp, "x-slack-signature": "v0=" + createHmac("sha256", mocks.config.slackSigningSecret).update(`v0:${timestamp}:${body}`).digest("hex") };
  return new NextRequest(`https://bot-controls.example/${platform}`, { method: "POST", body, headers });
}
function text(body: Record<string, unknown>, platform: Platform) {
  return String(platform === "discord" ? (body.data as { content: string }).content : body.text);
}
function assertPrivate(body: Record<string, unknown>, platform: Platform) {
  if (platform === "discord") expect(body).toMatchObject({ type: 4, data: { flags: 64 } });
  else if (platform === "slack") expect(body.response_type).toBe("ephemeral");
  else expect(body).toMatchObject({ method: "sendMessage", chat_id: 789, protect_content: true });
}
it.each(platforms.flatMap(platform => (["en", "vi", "pt", "es", "fr", "zh-Hans", "de", "ja", "ko", "hi", "id"] as const).map(language => [platform, language] as const)))
  ("%s saves %s help preference for the verified sender, with no paid admission or outbound call", async (platform, language) => {
    const saved = await (await handlers[platform](request(platform, "language", language))).json();
    assertPrivate(saved, platform);
    expect(text(saved, platform)).toContain(botControlsCatalogues[language].languageSaved.replace("{preference}", language));
    const help = await (await handlers[platform](request(platform, "help"))).json();
    assertPrivate(help, platform); expect(text(help, platform)).toContain(botControlsCatalogues[language].languageHelp);
    expect([...state.values()]).toEqual([language, language]);
    expect(mocks.admission).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.after).toEqual([]); expect(fetchMock).not.toHaveBeenCalled();
  });
it.each(platforms)("%s refuses invalid authentication before any preference read/write", async platform => {
  const req = request(platform, "language", "es");
  req.headers.set(platform === "telegram" ? "x-telegram-bot-api-secret-token" : platform === "discord" ? "x-signature-ed25519" : "x-slack-signature", "invalid");
  expect((await handlers[platform](req)).status).toBe(401);
  expect(mocks.db).not.toHaveBeenCalled(); expect(state.size).toBe(0); expect(mocks.after).toEqual([]);
});
it("Slack's stale signed control cannot read or write preferences", async () => {
  const req = request("slack", "language", "es"); req.headers.set("x-slack-request-timestamp", "1");
  expect((await slack(req)).status).toBe(401); expect(mocks.db).not.toHaveBeenCalled();
});
it("Telegram refuses group preference operations and ignores bot senders without opening storage", async () => {
  const group = await (await telegram(request("telegram", "language", "es", { group: true, platformLocale: "vi" }))).json();
  expect(group.text).toBe(botControlsCatalogues.vi.languagePrivate); expect(group.chat_id).toBe(-123);
  const help = await (await telegram(request("telegram", "help", undefined, { group: true, platformLocale: "vi" }))).json();
  expect(help.text).not.toContain(botControlsCatalogues.vi.privateQuestion);
  expect(await (await telegram(request("telegram", "language", "es", { bot: true }))).json()).toEqual({ ok: true });
  expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.after).toEqual([]);
});
it.each(["discord", "slack"] as const)("%s separates application/workspace and sender preferences", async platform => {
  await handlers[platform](request(platform, "language", "es"));
  for (const options of [{ scope: platform === "discord" ? "124" : "T124" }, { user: platform === "discord" ? "790" : "U790" }]) {
    const response = await (await handlers[platform](request(platform, "help", undefined, options))).json();
    expect(text(response, platform)).toContain(botControlsCatalogues.en.languageHelp);
  }
});
it.each(platforms)("%s reports storage failure without claiming a save or leaking backend details", async platform => {
  mocks.db.mockRejectedValue(new Error("private backend / account detail"));
  const response = await (await handlers[platform](request(platform, "language", "es"))).json();
  expect(text(response, platform)).toContain(botControlsCatalogues.en.languageUnavailable);
  expect(JSON.stringify(response)).not.toContain("private backend"); expect(mocks.after).toEqual([]);
});
it.each(["telegram", "discord"] as const)("%s bare help uses supported sender locale, with English fallback", async platform => {
  for (const [hint, expected] of [["vi", "vi"], ["pt-BR", "pt"], ["es-ES", "es"], ["fr-FR", "fr"],
    ["zh-Hans", "zh-Hans"], ["zh-CN", "zh-Hans"], ["zh-SG", "zh-Hans"],
    ["zh-Hant", "en"], ["zh-TW", "en"], ["zh-HK", "en"], ["de", "de"], ["de-DE", "de"],
    ["ja-JP", "ja"], ["ko-KR", "ko"], ["hi-IN", "hi"], ["id-ID", "id"], ["zz-unsupported", "en"]] as const) {
    const reply = await (await handlers[platform](request(platform, "help", undefined, { platformLocale: hint }))).json();
    expect(text(reply, platform)).toContain(botControlsCatalogues[expected].languageHelp);
  }
});
it("stored help language cannot rewrite the original question, answer/evidence, money or payment mode", async () => {
  const originalQuestion = "Trả lời bằng tiếng Việt. Giải thích x402.", quote = 'Exact original “evidence” <tag> & [S1]';
  await telegram(request("telegram", "language", "es"));
  mocks.collect.mockImplementation(async (input: { question: string; queryId: string }): Promise<QueryRun> => ({
    id: input.queryId, question: input.question, answer: quote, budget: 0.025, engine: "heuristic", subClaims: [], decisions: [],
    citations: [], totalSpent: 0.000001, totalToCreators: 0.000001, paymentMode: "offline", trace: [], createdAt: "2026-10-12T00:00:00Z" }));
  const sent: Record<string, unknown>[] = [];
  fetchMock.mockImplementation(async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body))); return Response.json({ ok: true, result: { message_id: 55 } });
  });
  await telegram(request("telegram", "ask", originalQuestion)); await mocks.after[0]();
  expect(mocks.collect.mock.calls[0][0]).toMatchObject({ question: originalQuestion, budget: 0.025 });
  expect(mocks.collect.mock.calls[0][0]).not.toHaveProperty("originalQuestion");
  expect(sent[0].text).toBe(botResearchMessages(originalQuestion)("dispatching"));
  expect(sent[1].text).toContain('Exact original “evidence” &lt;tag&gt; &amp; [S1]');
  expect(sent[1].text).toContain("$0,000001");
  expect(sent[1].text).toContain(" / offline");
  expect(await db.getSyncState(botPreferenceKey({ platform: "telegram", scope: "telegram", userId: "789" })!)).toBe("es");
});
