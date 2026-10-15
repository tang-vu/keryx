import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createChatAccountRoutes } from "../chat-accounts/http";
import { chatTokenHash } from "../chat-accounts/service";
import type { AccountSnapshot } from "../accounts/contracts";
import type { KeryxDB } from "../db/keryx-db";
import { ChatAccountError } from "../chat-accounts/contracts";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

// Synthetic request-boundary collaborators only. Native authority is exercised
// separately by chat-accounts-sqlite.test.ts; none of these are production bypasses.
const binding = { origin: "https://keryx.example", network: "eip155:5042" as const }, token = "a".repeat(64);
const wallet = `0x${"1".repeat(40)}`, accountId = `acct_${"2".repeat(64)}`;
let routes: ReturnType<typeof createChatAccountRoutes>, session: Mock<Parameters<typeof createChatAccountRoutes>[0]["session"]>, resolve: ReturnType<typeof vi.fn>,
  complete: ReturnType<typeof vi.fn>, preview: ReturnType<typeof vi.fn>;
const recipient = { platform: "telegram" as const, scope: "telegram", userId: "7", channel: "7" };
let consentProof: string;
const input = () => ({ token, consentProof, accountId, revision: 1, consent: { version: 1, linkFutureRuns: true, financialAuthorityUnchanged: true }, pastRunIds: [] });
async function prepare() {
  const result = await routes.account(req({ action: "preview", token }, binding.origin, "/api/me/chat-accounts"));
  expect(result.status).toBe(200);
  consentProof = (await result.json()).consentProof;
}
const req = (body: unknown, origin: string | null = binding.origin, path = "/api/me/chat-accounts/complete") =>
  new Request(binding.origin + path, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "PUBLIC-SYNTHETIC-CHAT263-CONSENT-TEST-SECRET");
  consentProof = `0.${"0".repeat(64)}`;
  const now = Date.now(), hash = "3".repeat(64);
  const snapshot = { membership: { version: 1, accountId, revision: 1, createdAt: now - 1000,
    members: [{ wallet, generation: "4".repeat(64), linkedAt: now - 1000 }] }, session: { sessionHash: hash, wallet, issuedAt: now - 1000, expiresAt: now + 10000 },
    memberGeneration: "4".repeat(64), credentialGeneration: "5".repeat(64), binding } as AccountSnapshot;
  complete = vi.fn().mockResolvedValue({ ...recipient, accountId }); resolve = vi.fn().mockResolvedValue(snapshot);
  preview = vi.fn().mockResolvedValue({ recipient, expiresAt: now + 10000 });
  const db = Object.defineProperties({ getWebSession: vi.fn().mockResolvedValue({ hash, wallet, issuedAt: now - 1000, expiresAt: now + 10000 }) }, {
    accountMembership: { value: { resolve, assertCurrent: vi.fn() } },
    chatAccountLinks: { value: { complete, preview, issue: vi.fn(), lookup: vi.fn(), unlink: vi.fn(), unlinkAccount: vi.fn(), list: vi.fn().mockResolvedValue([]) } },
  }) as unknown as KeryxDB;
  session = vi.fn<Parameters<typeof createChatAccountRoutes>[0]["session"]>().mockResolvedValue({ db, wallet, currentId: hash });
  routes = createChatAccountRoutes({ binding, session });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("chat263 account consent routes (UNRUN)", () => {
  it("authenticates account before preview and requires explicit exact consent for completion", async () => {
    const seen = await routes.account(req({ action: "preview", token }, binding.origin, "/api/me/chat-accounts"));
    expect(seen.status).toBe(200); expect(preview).toHaveBeenCalledWith(chatTokenHash(token), binding); expect(complete).not.toHaveBeenCalled();
    const shown = await seen.json(); consentProof = shown.consentProof;
    expect(JSON.stringify(shown)).not.toContain("3".repeat(64));
    const done = await routes.complete(req(input())); expect(done.status).toBe(200); expect(complete).toHaveBeenCalledTimes(1);
    expect(done.headers.get("referrer-policy")).toBe("no-referrer"); expect(done.headers.get("cache-control")).toContain("no-store");
    expect(await done.text()).not.toContain(token);
  });
  it.each([null, "https://foreign.example"])("refuses CSRF before session/storage: %s", async origin => {
    expect((await routes.complete(req(input(), origin))).status).toBe(403); expect(session).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });
  it("refuses bearer, missing membership, changed account, identity injection and absent consent", async () => {
    const bearer = req(input()); bearer.headers.set("authorization", "Bearer synthetic");
    expect((await routes.complete(bearer)).status).toBe(401); expect(session).not.toHaveBeenCalled();
    for (const value of [{ ...input(), recipient }, { ...input(), wallet }, { ...input(), consent: {} }])
      expect((await routes.complete(req(value))).status).toBe(400);
    expect((await routes.complete(req({ ...input(), accountId: `acct_${"f".repeat(64)}` }))).status).toBe(409);
    resolve.mockResolvedValue(null); expect((await routes.complete(req(input()))).status).toBe(409); expect(complete).not.toHaveBeenCalled();
  });
  it("explicitly refuses historical attach and query credentials without consuming", async () => {
    const unavailable = await routes.complete(req({ ...input(), pastRunIds: ["old-run"] }));
    expect(unavailable.status).toBe(409); expect(await unavailable.text()).toContain("chat_past_runs_unavailable");
    expect((await routes.complete(req(input(), binding.origin, `/api/me/chat-accounts/complete?token=${token}`))).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
  it("returns bounded static errors without credential or exception reflection", async () => {
    await prepare();
    complete.mockRejectedValue(new Error(`synthetic storage failure ${token}`));
    const failure = await routes.complete(req(input())); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain(token);
    expect((await routes.complete(req({ ...input(), junk: "x".repeat(5000) }))).status).toBe(503);
  });
  it.each(["sessionHash", "issuedAt", "expiresAt", "wallet", "memberGeneration", "credentialGeneration"])
    ("rejects a preview reused under changed %s without consuming", async field => {
      await prepare();
      const original: AccountSnapshot = await (resolve as () => Promise<AccountSnapshot>)();
      const changed = structuredClone(original);
      if (field === "sessionHash") changed.session.sessionHash = "6".repeat(64);
      if (field === "issuedAt") changed.session.issuedAt++;
      if (field === "expiresAt") changed.session.expiresAt++;
      if (field === "wallet") changed.session.wallet = `0x${"6".repeat(40)}`;
      if (field === "memberGeneration") changed.memberGeneration = "6".repeat(64);
      if (field === "credentialGeneration") changed.credentialGeneration = "6".repeat(64);
      resolve.mockResolvedValue(changed);
      expect((await routes.complete(req(input()))).status).toBe(409); expect(complete).not.toHaveBeenCalled();
      resolve.mockResolvedValue(original); expect((await routes.complete(req(input()))).status).toBe(200);
    });
  it("refuses tampered proof, wrong token, changed revision and missing proof before consumption", async () => {
    await prepare();
    const tampered = consentProof.slice(0, -1) + (consentProof.endsWith("0") ? "1" : "0");
    for (const value of [{ ...input(), consentProof: tampered }, { ...input(), token: "b".repeat(64) }, { ...input(), revision: 2 }])
      expect((await routes.complete(req(value))).status).toBe(409);
    expect((await routes.complete(req({ ...input(), consentProof: undefined }))).status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
  it.each(["origin", "network"])("binds the proof to original %s even for an otherwise authorized realm", async field => {
    await prepare(); const snapshot: AccountSnapshot = structuredClone(await (resolve as () => Promise<AccountSnapshot>)());
    const otherBinding = field === "origin" ? { ...binding, origin: "https://other.example" }
      : { ...binding, network: "eip155:5042002" as const };
    snapshot.binding = otherBinding; resolve.mockResolvedValue(snapshot);
    const other = createChatAccountRoutes({ binding: otherBinding, session });
    const request = new Request(otherBinding.origin + "/api/me/chat-accounts/complete", { method: "POST",
      headers: { Origin: otherBinding.origin, "Content-Type": "application/json" }, body: JSON.stringify(input()) });
    expect((await other.complete(request)).status).toBe(409); expect(complete).not.toHaveBeenCalled();
  });
  it("expires the preview and retains token single-use refusal", async () => {
    await prepare(); const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 11000);
    expect((await routes.complete(req(input()))).status).toBe(409); expect(complete).not.toHaveBeenCalled();
    clock.mockRestore();
    complete.mockResolvedValueOnce({ ...recipient, accountId }).mockRejectedValue(new ChatAccountError("chat_token_invalid"));
    expect((await routes.complete(req(input()))).status).toBe(200);
    expect((await routes.complete(req(input()))).status).toBe(410);
  });
  it.each([undefined, "weak"])("refuses absent/weak protected secret without issuing a preview proof (%s)", async secret => {
    vi.stubEnv("JWT_SECRET", secret);
    expect((await routes.account(req({ action: "preview", token }, binding.origin, "/api/me/chat-accounts"))).status).toBe(503);
    expect(complete).not.toHaveBeenCalled();
  });
});

// Actual signed/secret POST boundaries + actual chatControlReply; only downstream
// storage is synthetic. No live messages, research, providers or scheduling.
describe("private provider chat263 positive command contracts (UNRUN)", () => {
  const providerConfig = { baseUrl: binding.origin, networkId: binding.network,
    slackSigningSecret: "PUBLIC-SYNTHETIC-SLACK-SIGNING-SECRET", telegramWebhookSecret: "PUBLIC-SYNTHETIC-WEBHOOK-SECRET",
    telegramBotToken: "PUBLIC-SYNTHETIC-BOT-TOKEN" };
  let db: ReturnType<typeof vi.fn>, issue: ReturnType<typeof vi.fn>, lookup: ReturnType<typeof vi.fn>, unlink: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules(); issue = vi.fn(); lookup = vi.fn().mockResolvedValue(null); unlink = vi.fn();
    db = vi.fn().mockResolvedValue(Object.defineProperty({}, "chatAccountLinks", { value: {
      issue, lookup, unlink, preview: vi.fn(), complete: vi.fn(), list: vi.fn(), unlinkAccount: vi.fn(),
    } }));
    vi.doMock("@/lib/config", () => ({ config: providerConfig }));
    vi.doMock("@/lib/db", () => ({ getDb: db }));
    vi.doMock("@/lib/agent", () => ({ collectRun: vi.fn(() => { throw new Error("Research forbidden"); }) }));
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Outbound provider forbidden"); }));
  });
  afterEach(() => { vi.doUnmock("@/lib/config"); vi.doUnmock("@/lib/db"); vi.doUnmock("@/lib/agent"); vi.unstubAllGlobals(); });
  function slack(command: string, tamper = false) {
    const raw = new URLSearchParams({ command: "/keryx", text: command, team_id: "T123", user_id: "U123", channel_id: "D456" }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = "v0=" + createHmac("sha256", providerConfig.slackSigningSecret).update(`v0:${timestamp}:${raw}`).digest("hex");
    return new NextRequest(binding.origin + "/api/slack/commands", { method: "POST", body: tamper ? raw + "&text=changed" : raw,
      headers: { "x-slack-signature": signature, "x-slack-request-timestamp": timestamp } });
  }
  function telegram(command: string, secret = providerConfig.telegramWebhookSecret) {
    return new NextRequest(binding.origin + "/api/telegram/webhook", { method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify({ message: { message_id: 1, text: command, from: { id: 7, is_bot: false }, chat: { id: 7, type: "private" } } }) });
  }
  it.each(["slack", "telegram"])("issues hash-only private credential and disables previews through real %s POST", async platform => {
    const { POST } = platform === "slack" ? await import("../../app/api/slack/commands/route") : await import("../../app/api/telegram/webhook/route");
    const result = await POST(platform === "slack" ? slack("link") : telegram("/link"));
    expect(result.status).toBe(200); const reply = await result.json();
    expect(reply).toMatchObject(platform === "slack" ? { response_type: "ephemeral", unfurl_links: false, unfurl_media: false }
      : { method: "sendMessage", chat_id: 7, protect_content: true, link_preview_options: { is_disabled: true } });
    const match = /#token=([a-f0-9]{64})/.exec(reply.text); expect(match).not.toBeNull();
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue.mock.calls[0][0]).toMatchObject({ purpose: "chat-account-link-v1", tokenHash: chatTokenHash(match![1]), binding });
    expect(JSON.stringify(issue.mock.calls)).not.toContain(match![1]); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["slack", "telegram"])("supports private %s whoami/unlink without financial or outbound work", async platform => {
    const { POST } = platform === "slack" ? await import("../../app/api/slack/commands/route") : await import("../../app/api/telegram/webhook/route");
    const send = (command: string) => POST(platform === "slack" ? slack(command) : telegram(`/${command}`));
    lookup.mockResolvedValue({ wallet, accountId });
    expect((await (await send("whoami")).json()).text).toContain(accountId);
    expect((await (await send("unlink")).json()).text).toContain("unlinked");
    expect(unlink).toHaveBeenCalledTimes(1); expect(issue).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects tampered Slack raw bytes and wrong Telegram secret before storage", async () => {
    const slackRoute = await import("../../app/api/slack/commands/route"), telegramRoute = await import("../../app/api/telegram/webhook/route");
    expect((await slackRoute.POST(slack("link", true))).status).toBe(401);
    expect((await telegramRoute.POST(telegram("/link", "wrong"))).status).toBe(401);
    expect(db).not.toHaveBeenCalled(); expect(issue).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
