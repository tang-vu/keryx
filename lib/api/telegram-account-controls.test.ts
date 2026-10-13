import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(), presentation: vi.fn(), collect: vi.fn(), admission: vi.fn(), claim: vi.fn(), enabled: vi.fn(),
  privateReply: vi.fn(), after: vi.fn(),
  config: { baseUrl: "https://telegram-controls.example", telegramBotToken: "fixture-bot-token",
    telegramWebhookSecret: "fixture-webhook-secret", sellerAddress: "fixture-treasury",
    defaultBudget: 0.05, anonMaxBudget: 0.025 },
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/config", () => ({ config: mocks.config }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/bots/answer-preference", async original => ({
  ...await original<typeof import("@/lib/bots/answer-preference")>(),
  botAnswerPresentation: mocks.presentation,
}));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collect }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.admission }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ prepareHostedRunClaim: mocks.claim, hostedRunClaimsEnabled: mocks.enabled }));
vi.mock("@/lib/run-claims/telegram-private", () => ({ prepareTelegramPrivateReply: mocks.privateReply }));

import { POST } from "../../app/api/telegram/webhook/route";
import { helpText, telegramAccountLinkingUnavailable, type TelegramUpdate } from "../telegram/ask-message";
import { botControlsCatalogues } from "../bots/language";
import { botResearchMessages } from "../bots/research-messages";
import type { QueryRun } from "../types";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks.config, { telegramBotToken: "fixture-bot-token", telegramWebhookSecret: "fixture-webhook-secret",
    sellerAddress: "fixture-treasury", defaultBudget: 0.05, anonMaxBudget: 0.025 });
  mocks.db.mockRejectedValue(new Error("Account controls must not open storage"));
  mocks.presentation.mockResolvedValue({ language: "en", input: { presentationLanguage: "en" } });
  mocks.collect.mockRejectedValue(new Error("Unexpected research execution"));
  mocks.admission.mockResolvedValue(null);
  mocks.claim.mockResolvedValue(null);
  mocks.enabled.mockReturnValue(false);
  fetchMock = vi.fn(async () => { throw new Error("Unexpected outbound delivery"); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function update(text: string, chat = { id: 789, type: "private" }): TelegramUpdate {
  return { message: { message_id: 42, text, chat, from: { id: 789, is_bot: false, language_code: "es" } } };
}

/** Real POST/body and constant-time secret boundary; only downstream effects are mocked. */
function request(body: unknown = update("link"), secret: string | null = mocks.config.telegramWebhookSecret) {
  return new NextRequest("https://telegram-controls.example/api/telegram/webhook", { method: "POST",
    body: JSON.stringify(body), headers: { "content-type": "application/json",
      ...(secret === null ? {} : { "x-telegram-bot-api-secret-token": secret }) } });
}

function expectNoEffects() {
  expect(mocks.presentation).not.toHaveBeenCalled();
  expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.admission).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.collect).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.enabled).not.toHaveBeenCalled();
  expect(mocks.privateReply).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
}

async function expectUnavailable(text: string, chat = { id: 789, type: "private" }) {
  const response = await POST(request(update(text, chat)));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ method: "sendMessage", chat_id: chat.id,
    text: telegramAccountLinkingUnavailable, ...(chat.type === "private" ? { protect_content: true } : {}) });
  expectNoEffects();
}

describe("authenticated Telegram account-control refusal", () => {
  it.each(["link", "unlink", "whoami", "/link", "/unlink", "/whoami",
    "/link@KeryxHeraldBot", "/unlink@KeryxHeraldBot", "/whoami@KeryxHeraldBot"])
    ("refuses private %s before language/storage, sponsored admission and scheduling", async control => {
      await expectUnavailable(control);
    });

  it.each(["link", "unlink", "whoami", "/link@KeryxHeraldBot", "/unlink@KeryxHeraldBot", "/whoami@KeryxHeraldBot"])
    ("acknowledges group %s with only the fixed public-safe text", async control => {
      for (const type of ["group", "supergroup"]) {
        await expectUnavailable(`${control} fixture-private-account-token`, { id: -100123, type });
      }
    });

  it.each(["link fixture-private-account-token", "/link https://secret.example/?token=fixture-private-account-token",
    "unlink --confirm=fixture-private-account-token", "/unlink\n/language es fixture-private-account-token",
    "whoami\t{broken:fixture-private-account-token}", "/whoami@KeryxHeraldBot " + "fixture-private-account-token".repeat(1000)])
    ("never reflects or dispatches account arguments: %s", async text => {
      await expectUnavailable(`  ${text}  `);
    });

  it("refuses even when treasury is unavailable, admission would fail and claims are enabled", async () => {
    mocks.config.sellerAddress = "";
    mocks.admission.mockRejectedValue(new Error("Must not admit account controls"));
    mocks.enabled.mockReturnValue(true);
    await expectUnavailable("/link@KeryxHeraldBot fixture-private-account-token");
  });

  it.each([null, "", "wrong", "fixture-webhook-secrex"])
    ("rejects missing/invalid secret %s before reading the account body", async secret => {
      const req = request(update("/link fixture-private-account-token"), secret);
      const read = vi.spyOn(req, "json");
      const response = await POST(req);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid webhook secret" });
      expect(read).not.toHaveBeenCalled();
      expectNoEffects();
    });

  it.each(["telegramBotToken", "telegramWebhookSecret"] as const)
    ("keeps an unconfigured %s endpoint unavailable before reading the body", async field => {
      const req = request();
      const read = vi.spyOn(req, "json");
      mocks.config[field] = "";
      const response = await POST(req);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "telegram webhook not configured" });
      expect(read).not.toHaveBeenCalled();
      expectNoEffects();
    });

  it("rejects malformed JSON after a valid secret without any effects", async () => {
    const req = new NextRequest("https://telegram-controls.example/api/telegram/webhook", { method: "POST",
      body: '{"message":{"text":"link fixture-private-account-token"',
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": mocks.config.telegramWebhookSecret } });
    const response = await POST(req);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "malformed update body" });
    expectNoEffects();
  });

  it.each([null, [], "link fixture-private-account-token", 7, { message: null }, { message: [] },
    { message: { text: { token: "fixture-private-account-token" } } }].map(body => ({ body })))
    ("rejects malformed update shape %j before control or research handling", async ({ body }) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "malformed update body" });
      expectNoEffects();
    });

  it.each<TelegramUpdate>([{}, { message: { text: "/link fixture-private-account-token" } },
    { message: { text: "whoami", chat: { id: -100123, type: "group" }, from: { id: 789, is_bot: true } } },
    { message: { text: "unlink", chat: { id: -100123, type: "group" }, from: { id: 0 } } },
    { message: { text: "link", chat: { id: 1.5, type: "private" }, from: { id: 789 } } }])
    ("acknowledges unusable recipients/bot senders without replying or dispatching: %j", async body => {
      const response = await POST(request(body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expectNoEffects();
    });
});

describe("Telegram research and language compatibility", () => {
  it.each(["What does whoami do?", "Explain the link between citations and rewards.",
    "How do I unlink an account?", "linking accounts safely", "unlinkable sources", "whoami?",
    "/ask What is x402?", "/ask link fixture-research-word", "/ask@KeryxHeraldBot whoami"])
    ("preserves ordinary private research admission and scheduling: %s", async text => {
      const response = await POST(request(update(text)));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(mocks.admission).toHaveBeenCalledExactlyOnceWith({ kind: "bot", platform: "telegram", userId: "789" });
      expect(mocks.after).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
      // The callback is deliberately not executed in these admission fixtures.
      expect(mocks.presentation).not.toHaveBeenCalled();
      expect(mocks.db).not.toHaveBeenCalled();
      expect(mocks.collect).not.toHaveBeenCalled();
      expect(mocks.claim).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

  it("preserves group /ask and ignores ordinary group prose", async () => {
    const chat = { id: -100123, type: "group" };
    const ignored = await POST(request(update("Explain the link between citations and rewards.", chat)));
    expect(await ignored.json()).toEqual({ ok: true });
    expectNoEffects();
    const admitted = await POST(request(update("/ask@KeryxHeraldBot What is x402?", chat)));
    expect(await admitted.json()).toEqual({ ok: true });
    expect(mocks.admission).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("preserves the treasury-unavailable response for ordinary research", async () => {
    mocks.config.sellerAddress = "";
    const question = "What is x402?";
    const response = await POST(request(update(question)));
    expect(await response.json()).toEqual({ method: "sendMessage", chat_id: 789,
      text: botResearchMessages(question)("treasuryUnavailable") });
    expectNoEffects();
  });

  it("preserves sponsored-limit refusal for ordinary research without scheduling", async () => {
    mocks.admission.mockResolvedValue(Response.json({ error: "sponsored_rate_limit" }, { status: 429 }));
    const question = "What is x402?";
    const response = await POST(request(update(question)));
    expect(await response.json()).toEqual({ method: "sendMessage", chat_id: 789,
      text: botResearchMessages(question)("sponsoredLimited") });
    expect(mocks.admission).toHaveBeenCalledTimes(1);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["/help vi", "/help@KeryxHeraldBot vi"])("preserves request-local help for %s", async text => {
    mocks.db.mockResolvedValue({ getSyncState: vi.fn(async () => null) });
    const response = await POST(request(update(text)));
    expect(await response.json()).toEqual({ method: "sendMessage", chat_id: 789,
      text: helpText("vi", true), parse_mode: "HTML", protect_content: true });
    expect(mocks.admission).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves private language preferences and group privacy", async () => {
    const read = vi.fn(async () => null), write = vi.fn();
    mocks.db.mockResolvedValue({ getSyncState: read, setSyncState: write });
    const privateResponse = await POST(request(update("/language")));
    expect(await privateResponse.json()).toEqual({ method: "sendMessage", chat_id: 789,
      text: botControlsCatalogues.es.languageCurrent.replace("{preference}", "auto") + "\n" + botControlsCatalogues.es.languageHelp,
      parse_mode: "HTML", protect_content: true });
    expect(read).toHaveBeenCalledTimes(1);
    const groupResponse = await POST(request(update("/language es", { id: -100123, type: "group" })));
    expect(await groupResponse.json()).toEqual({ method: "sendMessage", chat_id: -100123,
      text: botControlsCatalogues.es.languagePrivate, parse_mode: "HTML" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.admission).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not resolve preferences after private-claim preparation refuses", async () => {
    mocks.claim.mockRejectedValue(new Error("Unadmitted private claim"));
    await POST(request(update("/ask What is x402?")));
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.presentation).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.privateReply).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[0.05, 0.025, 0.025], [0.01, 0.025, 0.01]])
    ("preserves default-OFF research and budget clamp %s/%s", async (defaultBudget, anonMaxBudget, expectedBudget) => {
      Object.assign(mocks.config, { defaultBudget, anonMaxBudget });
      const question = "What is x402?";
      const run: QueryRun = { id: "fixture-run", question, budget: expectedBudget, engine: "heuristic", subClaims: [],
        decisions: [], citations: [], answer: "Synthetic fixture answer", totalSpent: 0, totalToCreators: 0,
        trace: [], createdAt: "2026-10-13T00:00:00.000Z", paymentMode: "offline" };
      mocks.collect.mockResolvedValue(run);
      fetchMock.mockImplementation(async () => Response.json({ ok: true, result: { message_id: 100 } }));
      const response = await POST(request(update(`/ask ${question}`)));
      expect(await response.json()).toEqual({ ok: true });
      await mocks.after.mock.calls[0]![0](); // All research and delivery effects above are local mocks.
      expect(mocks.presentation).toHaveBeenCalledExactlyOnceWith(question, { platform: "telegram", scope: "telegram", userId: "789" });
      expect(mocks.collect).toHaveBeenCalledExactlyOnceWith({ question, presentationLanguage: "en", budget: expectedBudget, queryId: expect.any(String),
        origin: "web", provenance: { version: 1, surface: "telegram", ownershipMethod: "unknown" } });
      expect(mocks.privateReply).not.toHaveBeenCalled();
      expect(mocks.db).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
