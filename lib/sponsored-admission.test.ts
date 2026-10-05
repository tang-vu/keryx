import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./db/sqlite-adapter";
import type { QueryRun } from "./types";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), getSession: vi.fn(), getGrant: vi.fn(), collectRun: vi.fn(),
  getAgentDeps: vi.fn(), runAgent: vi.fn(), after: vi.fn(),
  discordPublicKey: "",
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./auth", () => ({ getSession: mocks.getSession }));
vi.mock("./payments/session-grants", () => ({ getGrant: mocks.getGrant }));
vi.mock("./agent", () => ({ collectRun: mocks.collectRun, getAgentDeps: mocks.getAgentDeps }));
vi.mock("./agent/run-agent", () => ({ runAgent: mocks.runAgent }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("./config", async original => {
  const actual = await original<typeof import("./config")>();
  return { ...actual, config: { ...actual.config, sellerAddress: "0x1111111111111111111111111111111111111111",
    get discordPublicKey() { return mocks.discordPublicKey; }, slackSigningSecret: "synthetic-slack-secret", telegramBotToken: "synthetic-token", telegramWebhookSecret: "synthetic-webhook-secret" } };
});

import { config } from "./config";
import { mintApiKey } from "./api-keys";
import { admissionNetwork, checkSponsoredResearchAdmission, checkApiKeyMintAdmission } from "./sponsored-admission";
import { POST as chat } from "../app/api/v1/chat/completions/route";
import { POST as mcp } from "../app/mcp/route";
import { POST as web } from "../app/api/ask/route";
import { POST as mint } from "../app/api/keys/route";
import { POST as discord } from "../app/api/discord/interactions/route";
import { POST as slack } from "../app/api/slack/commands/route";
import { POST as telegram } from "../app/api/telegram/webhook/route";

const OWNER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const wallet = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
const discordKeys = generateKeyPairSync("ed25519");
let directory: string;
let db: SqliteAdapter;
const opened: SqliteAdapter[] = [];

function completedRun(): QueryRun {
  return { id: crypto.randomUUID(), question: "Synthetic question", budget: 0.03, engine: "fixture", subClaims: [],
    decisions: [], citations: [], answer: "Synthetic answer", totalSpent: 0, totalToCreators: 0,
    trace: [], createdAt: new Date().toISOString(), paymentMode: "offline" };
}

function request(url: string, body: unknown, ip = "192.0.2.1", key?: string) {
  return new NextRequest(`http://localhost${url}`, { method: "POST", headers: {
    "content-type": "application/json", "cf-connecting-ip": ip,
    accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}),
  }, body: JSON.stringify(body) });
}

const chatRequest = (ip?: string, key?: string) => request("/api/v1/chat/completions", {
  messages: [{ role: "user", content: "Synthetic question" }],
}, ip, key);
const mcpRequest = (ip?: string, key?: string) => request("/mcp", {
  jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "research", arguments: { question: "Synthetic question" } },
}, ip, key);
const webRequest = (ip?: string, extra: Record<string, unknown> = {}) => request("/api/ask", { question: "Synthetic question", ...extra }, ip);

function discordRequest(userId = "discord-user") {
  const body = JSON.stringify({ type: 2, application_id: "synthetic-app", token: "synthetic-token", user: { id: userId },
    data: { name: "ask", options: [{ name: "question", value: "Synthetic question" }] } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new NextRequest("http://localhost/api/discord/interactions", { method: "POST", body, headers: {
    "x-signature-timestamp": timestamp,
    "x-signature-ed25519": sign(null, Buffer.from(timestamp + body), discordKeys.privateKey).toString("hex"),
  } });
}
function slackRequest(userId = "slack-user") {
  const body = new URLSearchParams({ text: "Synthetic question", user_id: userId, response_url: "https://hooks.slack.com/synthetic" }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new NextRequest("http://localhost/api/slack/commands", { method: "POST", body, headers: {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${createHmac("sha256", config.slackSigningSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`,
  } });
}
const telegramRequest = (userId = 123) => new NextRequest("http://localhost/api/telegram/webhook", { method: "POST", headers: {
  "content-type": "application/json", "x-telegram-bot-api-secret-token": config.telegramWebhookSecret,
}, body: JSON.stringify({ message: { text: "/ask Synthetic question", chat: { id: 321 }, from: { id: userId } } }) });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("KERYX_SPONSORED_DISPATCHES_PER_MINUTE", "60");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in admission fixture"); }));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-sponsored-"));
  db = new SqliteAdapter(path.join(directory, "test.sqlite"));
  await db.init(); opened.push(db);
  mocks.getDb.mockResolvedValue(db);
  mocks.getSession.mockResolvedValue(null);
  mocks.getGrant.mockResolvedValue(undefined);
  mocks.collectRun.mockImplementation(async () => completedRun());
  mocks.runAgent.mockImplementation(() => (async function* () { return completedRun(); })());
  mocks.getAgentDeps.mockResolvedValue({ engine: { name: "fixture" }, gateway: { mode: "offline" }, db });
  mocks.discordPublicKey = discordKeys.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
});
afterEach(() => {
  while (opened.length) opened.pop()!.close();
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("shared sponsored admission with durable identity", () => {
  it("two minted keys and both research APIs share one canonical wallet allowance", async () => {
    const first = await mintApiKey(OWNER, "first", "ask");
    const second = await mintApiKey(OWNER.toUpperCase().replace("0X", "0x"), "second", "ask");
    for (let i = 0; i < 10; i++) {
      const response = i % 2 === 0
        ? await chat(chatRequest(`192.0.2.${i + 1}`, first.rawKey))
        : await mcp(mcpRequest(`192.0.2.${i + 1}`, second.rawKey));
      expect(response.status).toBe(200); await response.text();
    }
    const rejected = await chat(chatRequest("192.0.2.111", second.rawKey));
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("Retry-After")).toBeTruthy();
    expect(mocks.collectRun).toHaveBeenCalledTimes(10);
    // A new adapter/process cannot reset the shared allowance.
    const restarted = new SqliteAdapter(path.join(directory, "test.sqlite"));
    await restarted.init(); opened.push(restarted); mocks.getDb.mockResolvedValue(restarted);
    expect((await mcp(mcpRequest("192.0.2.112", first.rawKey))).status).toBe(429);
    expect(fs.readFileSync(path.join(directory, "test.sqlite")).includes(Buffer.from(first.rawKey))).toBe(false);
  });

  it("wallet farming cannot exceed the direct-IP allowance", async () => {
    for (let i = 0; i < 11; i++) {
      const key = await mintApiKey(wallet(i + 1), "farmed", "ask");
      const response = await chat(chatRequest("192.0.2.10", key.rawKey));
      expect(response.status).toBe(i < 10 ? 200 : 429); await response.text();
    }
    expect(mocks.collectRun).toHaveBeenCalledTimes(10);
  });

  it("anonymous web, chat, and MCP calls share five calls rather than five per surface", async () => {
    const calls = [() => web(webRequest()), () => chat(chatRequest()), () => mcp(mcpRequest())];
    for (let i = 0; i < 5; i++) {
      const response = await calls[i % calls.length]!();
      expect(response.status).toBe(200); await response.text();
    }
    for (const call of calls) expect((await call()).status).toBe(429);
    expect(mocks.collectRun.mock.calls.length + mocks.runAgent.mock.calls.length).toBe(5);
  });

  it("all six hosted surfaces share global admission before work or deferred bot dispatch", async () => {
    vi.stubEnv("KERYX_SPONSORED_DISPATCHES_PER_MINUTE", "6");
    const calls = [() => web(webRequest("192.0.2.1")), () => chat(chatRequest("192.0.2.2")), () => mcp(mcpRequest("192.0.2.3")),
      () => discord(discordRequest()), () => slack(slackRequest()), () => telegram(telegramRequest())];
    for (const call of calls) { const response = await call(); expect(response.status).toBe(200); await response.text(); }
    expect(mocks.collectRun).toHaveBeenCalledTimes(2); expect(mocks.runAgent).toHaveBeenCalledTimes(1); expect(mocks.after).toHaveBeenCalledTimes(3);
    for (const call of calls.slice(0, 3)) expect((await call()).status).toBe(429);
    for (const call of calls.slice(3)) expect(await (await call()).text()).toContain("temporarily limited or unavailable");
    expect(mocks.collectRun).toHaveBeenCalledTimes(2); expect(mocks.runAgent).toHaveBeenCalledTimes(1); expect(mocks.after).toHaveBeenCalledTimes(3);
  });

  it("the global durable counter caps concurrent farmed identities without admission refunds", async () => {
    vi.stubEnv("KERYX_SPONSORED_DISPATCHES_PER_MINUTE", "7");
    const decisions = await Promise.all(Array.from({ length: 40 }, (_, i) => checkSponsoredResearchAdmission({ kind: "key", wallet: wallet(i), ip: `192.0.2.${i}` })));
    expect(decisions.filter(response => response === null)).toHaveLength(7);
    expect(decisions.filter(response => response?.status === 429)).toHaveLength(33);
  });

  it("defaults to sixty dispatches per fixed minute and renews only after that window expires", async () => {
    vi.stubEnv("KERYX_SPONSORED_DISPATCHES_PER_MINUTE", undefined);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
    for (let i = 0; i < 60; i++) {
      expect(await checkSponsoredResearchAdmission({ kind: "anonymous", ip: `192.0.2.${i}` })).toBeNull();
    }
    expect((await checkSponsoredResearchAdmission({ kind: "anonymous", ip: "192.0.2.100" }))?.status).toBe(429);
    vi.mocked(Date.now).mockReturnValue(now + 60_001);
    expect(await checkSponsoredResearchAdmission({ kind: "anonymous", ip: "192.0.2.100" })).toBeNull();
  });

  it("gives one allowance to an IPv6 /64 and leaves IPv4 and unparseable input as given", async () => {
    expect(admissionNetwork("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(admissionNetwork("2001:0DB8:0001:0002::ffff")).toBe("2001:db8:1:2::/64");
    expect(admissionNetwork("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(admissionNetwork("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(admissionNetwork("192.0.2.7")).toBe("192.0.2.7");
    expect(admissionNetwork("not:an:address")).toBe("not:an:address");
    expect(admissionNetwork("")).toBe("unknown");
    for (let i = 0; i < 5; i++) {
      expect(await checkSponsoredResearchAdmission({ kind: "anonymous", ip: `2001:db8:1:2::${i + 1}` })).toBeNull();
    }
    expect((await checkSponsoredResearchAdmission({ kind: "anonymous", ip: "2001:db8:1:2:ffff::9" }))?.status).toBe(429);
    expect(await checkSponsoredResearchAdmission({ kind: "anonymous", ip: "2001:db8:1:3::1" })).toBeNull();
  });

  it("daily caps bound a caller and the whole service across minute windows", async () => {
    vi.stubEnv("KERYX_SPONSORED_DISPATCHES_PER_CALLER_PER_DAY", "6");
    vi.stubEnv("KERYX_SPONSORED_DISPATCHES_PER_DAY", "8");
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
    const ask = (ip: string) => checkSponsoredResearchAdmission({ kind: "anonymous", ip });
    for (let i = 0; i < 5; i++) expect(await ask("192.0.2.1")).toBeNull();
    vi.mocked(Date.now).mockReturnValue(now + 60_001);
    expect(await ask("192.0.2.1")).toBeNull();
    // A fresh minute window does not renew the caller's day.
    expect((await ask("192.0.2.1"))?.status).toBe(429);
    expect(await ask("192.0.2.2")).toBeNull();
    expect(await ask("192.0.2.3")).toBeNull();
    // Eight admitted service-wide: a new caller is refused until the day rolls over.
    expect((await ask("192.0.2.4"))?.status).toBe(429);
    vi.mocked(Date.now).mockReturnValue(now + 86_400_001);
    expect(await ask("192.0.2.4")).toBeNull();
    expect(await ask("192.0.2.1")).toBeNull();
  });

  it("bot users retain their own five-call allowance and provider namespaces do not collide", async () => {
    for (let i = 0; i < 5; i++) expect((await discord(discordRequest("same-id"))).status).toBe(200);
    expect(mocks.after).toHaveBeenCalledTimes(5);
    expect(await (await discord(discordRequest("same-id"))).text()).toContain("temporarily limited or unavailable");
    await slack(slackRequest("same-id"));
    expect(mocks.after).toHaveBeenCalledTimes(6);
  });

  it("a store outage refuses every sponsored surface before work, including bot after()", async () => {
    vi.spyOn(db, "consumeRateLimit").mockRejectedValue(new Error("synthetic durable outage"));
    for (const call of [() => web(webRequest()), () => chat(chatRequest()), () => mcp(mcpRequest())]) {
      const response = await call(); expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: "sponsored_admission_unavailable" });
    }
    for (const call of [() => discord(discordRequest()), () => slack(slackRequest()), () => telegram(telegramRequest())]) {
      expect(await (await call()).text()).toContain("temporarily limited or unavailable");
    }
    expect(mocks.collectRun).not.toHaveBeenCalled(); expect(mocks.getAgentDeps).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });

  it("invalid global configuration fails closed and Session-funded requests skip sponsorship", async () => {
    vi.stubEnv("KERYX_SPONSORED_DISPATCHES_PER_MINUTE", "unlimited");
    expect((await chat(chatRequest())).status).toBe(503);
    mocks.getSession.mockResolvedValue({ address: OWNER });
    mocks.getGrant.mockResolvedValue({ ownerAddr: OWNER, cap: 1, spent: 0, expiry: Date.now() + 60_000 });
    vi.spyOn(db, "browserJournalActive").mockResolvedValue(true);
    const response = await web(webRequest(undefined, { sessionId: OWNER, browserAuthorizationProtocol: "durable-v1" }));
    expect(response.status).toBe(200); await response.text();
    expect(mocks.runAgent).toHaveBeenCalledTimes(1);
  });

  it("API key minting has separate wallet/IP caps and cannot reset research quota", async () => {
    mocks.getSession.mockResolvedValue({ address: OWNER });
    for (let i = 0; i < 10; i++) {
      const response = await mint(request("/api/keys", { label: `key-${i}`, scopes: ["ask"] }));
      expect(response.status).toBe(200);
    }
    const blocked = await mint(request("/api/keys", { label: "key-11" }));
    expect(blocked.status).toBe(429); expect(await blocked.json()).toMatchObject({ error: "api_key_mint_rate_limit" });
    expect(await db.listApiKeys(OWNER)).toHaveLength(10);
    expect(await checkSponsoredResearchAdmission({ kind: "key", wallet: OWNER, ip: "192.0.2.1" })).toBeNull();
    expect((await checkApiKeyMintAdmission(wallet(2), "192.0.2.1"))?.status).toBe(429);
  });

  it("mint outage refuses key creation and invalid research/key scopes do not debit sponsorship", async () => {
    const restricted = await mintApiKey(OWNER, "export-only", "export");
    const consume = vi.spyOn(db, "consumeRateLimit");
    expect((await chat(chatRequest(undefined, restricted.rawKey))).status).toBe(403);
    expect((await mcp(mcpRequest(undefined, restricted.rawKey))).status).toBe(403);
    expect((await chat(request("/api/v1/chat/completions", { messages: [{ role: "user", content: "" }] }))).status).toBe(400);
    mocks.getSession.mockResolvedValue({ address: OWNER });
    expect((await mint(request("/api/keys", null))).status).toBe(400);
    expect(consume).not.toHaveBeenCalled();
    mocks.getSession.mockResolvedValue({ address: OWNER }); consume.mockRejectedValue(new Error("synthetic outage"));
    expect((await mint(request("/api/keys", { label: "not-created" }))).status).toBe(503);
    expect(await db.listApiKeys(OWNER)).toHaveLength(1);
  });
});
