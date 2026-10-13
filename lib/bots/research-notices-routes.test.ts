import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import { botResearchMessages } from "./research-messages";
import { ResearchAdmissionHeldError } from "../research/availability-contract";

const mocks = vi.hoisted(() => ({
  collect: vi.fn(), claim: vi.fn(), limited: vi.fn(), after: [] as (() => Promise<unknown>)[],
  config: { baseUrl: "https://bot-fixture.example", defaultBudget: 0.05, anonMaxBudget: 0.025,
    sellerAddress: "synthetic-treasury", discordPublicKey: "synthetic-key", slackSigningSecret: "synthetic-secret",
    telegramBotToken: "synthetic-token", telegramWebhookSecret: "synthetic-webhook" },
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(),
  after: (fn: () => Promise<unknown>) => mocks.after.push(fn) }));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collect }));
vi.mock("@/lib/config", () => ({ config: mocks.config }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.limited }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ prepareHostedRunClaim: mocks.claim, hostedRunClaimsEnabled: () => false }));
vi.mock("@/lib/discord/verify-interaction-signature", () => ({ verifyInteractionSignature: () => true }));
vi.mock("@/lib/slack/verify-request-signature", () => ({ verifyRequestSignature: () => true }));
import { POST as discord } from "../../app/api/discord/interactions/route";
import { POST as slack } from "../../app/api/slack/commands/route";
import { POST as telegram } from "../../app/api/telegram/webhook/route";

type Platform = "discord" | "slack" | "telegram";
const platforms: Platform[] = ["discord", "slack", "telegram"];
const questions = ["Answer in English. Explain x402.", "Trả lời bằng tiếng Việt. Giải thích x402.",
  "Responda em português. Explique x402.", "En español, explique x402."];
const cases = platforms.flatMap(platform => questions.map(question => [platform, question] as const));
const sent: { url: string; body: Record<string, unknown> }[] = [];
const handlers = { discord, slack, telegram };
function request(platform: Platform, question: string): NextRequest {
  const body = platform === "discord" ? JSON.stringify({ type: 2, application_id: "synthetic-app", token: "synthetic-interaction",
    member: { user: { id: "123456789012345678" } }, data: { name: "ask", options: [{ name: "question", value: question }, { name: "budget", value: 9 }] } })
    : platform === "slack" ? new URLSearchParams({ command: "/keryx", text: question, user_id: "caller-1", channel_id: "room",
      response_url: "https://hooks.slack.com/commands/synthetic/private" }).toString()
      : JSON.stringify({ message: { message_id: 42, text: `/ask ${question}`, chat: { id: 789, type: "private" }, from: { id: 789 } } });
  return new NextRequest(`https://bot-fixture.example/${platform}`, { method: "POST", body,
    headers: platform === "telegram" ? { "x-telegram-bot-api-secret-token": "synthetic-webhook" } : {} });
}
function saved(input: { question: string; queryId: string; budget: number }): QueryRun {
  return { id: input.queryId, question: input.question, budget: input.budget, engine: "heuristic", subClaims: [], decisions: [],
    citations: [], answer: 'Exact quoted evidence: “Answer in English. <unchanged>” [S1]', totalSpent: 0, totalToCreators: 0,
    trace: [], paymentMode: "offline", createdAt: "2026-10-11T00:00:00.000Z" };
}
beforeEach(() => {
  mocks.collect.mockReset().mockImplementation(async input => saved(input));
  mocks.claim.mockReset().mockResolvedValue(undefined); mocks.limited.mockReset().mockResolvedValue(null);
  mocks.after.length = 0; sent.length = 0; mocks.config.sellerAddress = "synthetic-treasury";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, result: { message_id: 55 } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(cases)("%s/%s refuses missing treasury with localized text and no changed admission effects", async (platform, question) => {
  mocks.config.sellerAddress = "";
  const body = await (await handlers[platform](request(platform, question))).json();
  const text = platform === "discord" ? body.data.content : body.text;
  expect(text).toBe(botResearchMessages(question)("treasuryUnavailable"));
  if (platform === "discord") expect(body).toMatchObject({ type: 4, data: { flags: 64 } });
  if (platform === "slack") expect(body.response_type).toBe("ephemeral");
  if (platform === "telegram") expect(body).toMatchObject({ method: "sendMessage", chat_id: 789 });
  expect(mocks.limited).not.toHaveBeenCalled(); expect(mocks.after).toEqual([]);
  expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled(); expect(sent).toEqual([]);
});
it.each(cases)("%s/%s sponsored refusal preserves the same limiter authority before research", async (platform, question) => {
  mocks.limited.mockResolvedValue({ unavailable: true });
  const body = await (await handlers[platform](request(platform, question))).json();
  expect(platform === "discord" ? body.data.content : body.text).toBe(botResearchMessages(question)("sponsoredLimited"));
  expect(mocks.limited).toHaveBeenCalledExactlyOnceWith({ kind: "bot", platform, userId: platform === "discord" ? "123456789012345678" : platform === "telegram" ? "789" : "caller-1" });
  expect(mocks.after).toEqual([]); expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled();
});
it.each(cases)("%s/%s progress and result use original question, not evidence or transport metadata", async (platform, question) => {
  const body = await (await handlers[platform](request(platform, question))).json();
  expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.after).toHaveLength(1);
  if (platform === "discord") expect(body).toEqual({ type: 5, data: { flags: 64 } });
  if (platform === "slack") expect(body).toEqual({ response_type: "ephemeral", text: botResearchMessages(question)("dispatching") });
  await mocks.after[0]();
  expect(mocks.collect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ question, budget: 0.025, origin: "web",
    provenance: { version: 1, surface: platform, ownershipMethod: "unknown" } }));
  if (platform === "telegram") expect(sent[0].body.text).toBe(botResearchMessages(question)("dispatching"));
  const result = sent.at(-1)!.body;
  const detail = platform === "discord" ? (result.embeds as { description: string; footer: { text: string } }[])[0].description : result.text;
  expect(detail).toEqual(platform === "discord" ? saved({ question, queryId: "unused", budget: 0 }).answer
    : expect.stringContaining('Exact quoted evidence: “Answer in English. &lt;unchanged&gt;” [S1]'));
  expect(JSON.stringify(result)).toContain(botResearchMessages(question)("sourcesOther", { count: 0 }));
  expect(JSON.stringify(result)).not.toContain("/claim-run#");
  if (platform === "slack") expect(result).toMatchObject({ response_type: "ephemeral", unfurl_links: false, unfurl_media: false });
  if (platform === "telegram") expect(result).toMatchObject({ chat_id: 789, message_id: 55, parse_mode: "HTML" });
});
it.each(platforms)("%s localizes product pause without exposing private error details or retrying", async platform => {
  const question = questions[3]; mocks.collect.mockRejectedValue(new ResearchAdmissionHeldError("private cause"));
  await handlers[platform](request(platform, question)); await mocks.after[0]();
  const result = sent.at(-1)!.body;
  const text = platform === "discord" ? result.content : result.text;
  expect(text).toBe(botResearchMessages(question)("failure", { detail: botResearchMessages(question)("paused") }));
  expect(text).not.toContain("private cause"); expect(mocks.collect).toHaveBeenCalledTimes(1);
});
