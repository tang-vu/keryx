import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deliveryFixture } from "./delivery.test-fixture";
import { prepareTelegramPrivateReply } from "./telegram-private";
import { privateSlackResponseUrl } from "./slack-private";
const mocks = vi.hoisted(() => ({ db: vi.fn(), collect: vi.fn(), signature: vi.fn(), after: [] as (() => Promise<unknown>)[] }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: (fn: () => Promise<unknown>) => mocks.after.push(fn) }));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collect }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("@/lib/discord/verify-interaction-signature", () => ({ verifyInteractionSignature: mocks.signature }));
vi.mock("@/lib/slack/verify-request-signature", () => ({ verifyRequestSignature: mocks.signature }));
vi.mock("@/lib/config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, networkId: "eip155:5042002", baseUrl: "https://claims.example",
    sellerAddress: `0x${"1".repeat(40)}`, discordPublicKey: "synthetic-key", slackSigningSecret: "synthetic-secret",
    telegramBotToken: "synthetic-token", telegramWebhookSecret: "synthetic-webhook" } };
});
import { POST as discord } from "../../app/api/discord/interactions/route";
import { POST as slack } from "../../app/api/slack/commands/route";
import { POST as telegram } from "../../app/api/telegram/webhook/route";
let f: ReturnType<typeof deliveryFixture>, fetchMock: ReturnType<typeof vi.fn>, logs: ReturnType<typeof vi.spyOn>;
const calls: { url: string; body: Record<string, unknown> }[] = [];
beforeEach(() => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); f = deliveryFixture(); mocks.db.mockResolvedValue(f.db);
  mocks.collect.mockReset(); mocks.collect.mockImplementation(async (input: { queryId: string }) => f.save(input.queryId));
  mocks.signature.mockReturnValue(true); mocks.after.length = 0; calls.length = 0;
  logs = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); calls.push({ url, body });
    return Response.json({ ok: true, result: { message_id: 55, chat: { id: 789, type: "private" } } });
  }); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { f.sql.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const req = (path: string, body: string, headers = {}) => new NextRequest(`https://claims.example${path}`, { method: "POST", body, headers });
const discordBody = JSON.stringify({ type: 2, application_id: "synthetic-app", token: "synthetic-interaction", member: { user: { id: "123456789012345678" } },
  data: { name: "ask", options: [{ name: "question", value: "Synthetic private delivery" }] } });
const slackBody = (url = "https://hooks.slack.com/commands/synthetic/private") => new URLSearchParams({ command: "/keryx", text: "Synthetic private delivery", user_id: "user-1", channel_id: "room", response_url: url }).toString();
const telegramReq = () => req("/api/telegram/webhook", JSON.stringify({ message: { message_id: 42, chat: { id: -100123, type: "group" }, from: { id: 789, is_bot: false }, text: "/ask Synthetic private delivery" } }), { "x-telegram-bot-api-secret-token": "synthetic-webhook" });
it("Discord establishes ephemeral visibility in its initial ACK and edits only that private reply", async () => {
  const response = await discord(req("/api/discord/interactions", discordBody));
  expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } }); expect(mocks.collect).not.toHaveBeenCalled();
  await mocks.after[0](); expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain("/messages/@original"); expect(calls[0].body.content).toContain("/claim-run#");
  expect(calls[0].body.allowed_mentions).toEqual({ parse: [] });
  expect(JSON.stringify(calls[0].body.embeds)).not.toContain("/claim-run#");
  expect(JSON.stringify(f.sql.prepare("SELECT * FROM query_runs").all())).not.toContain("/claim-run#");
});
it("Slack's ACK and final response are explicitly ephemeral, without public unfurls", async () => {
  expect(await (await slack(req("/api/slack/commands", slackBody()))).json()).toHaveProperty("response_type", "ephemeral");
  await mocks.after[0](); expect(calls[0].body).toMatchObject({ response_type: "ephemeral", unfurl_links: false, unfurl_media: false });
  expect(calls[0].body.text).toContain("/claim-run#");
});
it("invalid Slack private transport refuses before research and never sends to a foreign endpoint", async () => {
  await slack(req("/api/slack/commands", slackBody("https://foreign.example/private"))); await mocks.after[0]();
  expect(mocks.collect).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  for (const url of ["http://hooks.slack.com/private", "https://secret@hooks.slack.com/private", "https://hooks.slack.com/private#secret", "https://hooks.slack.com/private?token=x"])
    expect(privateSlackResponseUrl(url)).toBe(false);
});
it.each([null, { message_id: 55, chat: { id: -100123, type: "group" } }, { message_id: 55, chat: { id: 790, type: "private" } }])
  ("Telegram failed or mismatched private acknowledgement starts zero research: %j", async result => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return Response.json({ ok: true, result }); });
    await telegram(telegramReq()); await mocks.after[0]();
    expect(calls).toHaveLength(1); expect(calls[0].body.chat_id).toBe(789); expect(calls[0].body).not.toHaveProperty("reply_to_message_id");
    expect(mocks.collect).not.toHaveBeenCalled(); expect(f.sql.prepare("SELECT * FROM query_runs").all()).toEqual([]);
  });
it("Telegram confirms DM before research, and edit failure falls back only into that same private chat", async () => {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); calls.push({ url, body });
    if (url.endsWith("/editMessageText")) return Response.json({ ok: false, description: String(body.text) }, { status: 400 });
    return Response.json({ ok: true, result: { message_id: 55, chat: { id: 789, type: "private" } } });
  });
  mocks.collect.mockImplementation(async (input: { queryId: string }) => { expect(calls).toHaveLength(1); expect(calls[0].body.protect_content).toBe(true); return f.save(input.queryId); });
  await telegram(telegramReq()); await mocks.after[0]();
  expect(calls).toHaveLength(4); expect(calls.every(call => call.body.chat_id === 789)).toBe(true);
  expect(calls[1].body.text).not.toContain("/claim-run#"); expect(calls[2].body.text).toBe(calls[1].body.text); expect(calls[2].body.protect_content).toBe(true);
  expect(calls[3].body.text).toContain("/claim-run#"); expect(calls[3].body.protect_content).toBe(true); expect(calls[3].body).not.toHaveProperty("parse_mode");
  expect(JSON.stringify(logs.mock.calls)).not.toContain("/claim-run#"); expect(JSON.stringify(f.sql.prepare("SELECT * FROM query_runs").all())).not.toContain("/claim-run#");
});
it("Telegram delivers a full-size answer and private credential in separate bounded messages", async () => {
  mocks.collect.mockImplementation(async (input: { queryId: string }) => f.save(input.queryId, { answer: "x".repeat(3000),
    citations: Array.from({ length: 20 }, (_, i) => ({ marker: `S${i}`, sourceId: `source-${i}`, sourceName: "A long synthetic creator name".repeat(4), weight: 0.05, reward: 0, rationale: "synthetic" })) }));
  await telegram(telegramReq()); await mocks.after[0]();
  expect(calls).toHaveLength(3); expect(calls[1].body.text).not.toContain("/claim-run#");
  expect(String(calls[1].body.text)).toHaveLength(4096); expect(String(calls[2].body.text).length).toBeLessThanOrEqual(4096);
  expect(calls[2].body.text).toContain("/claim-run#"); expect(calls[2].body.chat_id).toBe(789); expect(calls[2].body.protect_content).toBe(true);
});
it("invalid bot authentication never schedules research or private delivery", async () => {
  mocks.signature.mockReturnValue(false);
  expect((await discord(req("/api/discord/interactions", discordBody))).status).toBe(401);
  expect((await slack(req("/api/slack/commands", slackBody()))).status).toBe(401);
  const badTelegram = telegramReq(); badTelegram.headers.set("x-telegram-bot-api-secret-token", "wrong");
  expect((await telegram(badTelegram)).status).toBe(401); expect(mocks.after).toEqual([]); expect(fetchMock).not.toHaveBeenCalled();
});
it("private Telegram address must be the authenticated sender and must exist before any message", async () => {
  const send = vi.fn();
  for (const command of [{ chatId: 790, userId: 789, chatType: "private" }, { chatId: -1, userId: 0, chatType: "group" }, { chatId: -1, userId: 789, chatType: "channel" }])
    expect(await prepareTelegramPrivateReply({ ...command, question: "Synthetic", messageId: 42 }, send)).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
