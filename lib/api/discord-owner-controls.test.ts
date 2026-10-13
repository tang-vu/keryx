import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botResearchMessages } from "../bots/research-messages";

const mocks = vi.hoisted(() => ({
  admission: vi.fn(), after: vi.fn(), collect: vi.fn(), claim: vi.fn(), db: vi.fn(), fetch: vi.fn(),
  config: { baseUrl: "https://discord-recipient.example", defaultBudget: 0.05, anonMaxBudget: 0.025,
    sellerAddress: "synthetic-treasury", discordPublicKey: "" },
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/config", () => ({ config: mocks.config }));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collect }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.admission }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ prepareHostedRunClaim: mocks.claim }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
// Keep the actual parser and Ed25519 verifier. Only work/delivery dependencies are intercepted.
import { POST } from "../../app/api/discord/interactions/route";

const keys = generateKeyPairSync("ed25519");
const foreignKeys = generateKeyPairSync("ed25519");
const question = "Synthetic private question must not be echoed on refusal";
const token = "synthetic-private-interaction-token";

function askPayload(overrides: Record<string, unknown> = {}) {
  return { type: 2, application_id: "123", token, member: { user: { id: "789" } },
    data: { name: "ask", options: [{ name: "question", value: question }, { name: "budget", value: 9 }] },
    ...overrides };
}
function signedRequest(rawBody: string, privateKey = keys.privateKey) {
  const timestamp = "1791878400";
  return new NextRequest("https://discord-recipient.example/api/discord/interactions", {
    method: "POST", body: rawBody, headers: { "content-type": "application/json",
      "x-signature-timestamp": timestamp,
      "x-signature-ed25519": sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex") },
  });
}
function expectNoWork() {
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.collect).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
}
function expectNoAdmissionOrWork() {
  expect(mocks.admission).not.toHaveBeenCalled();
  expectNoWork();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.discordPublicKey = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  mocks.admission.mockResolvedValue(null);
  for (const dependency of [mocks.collect, mocks.claim, mocks.db, mocks.fetch]) {
    dependency.mockRejectedValue(new Error("Work forbidden in recipient fixture"));
  }
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Discord recipient refusal through the actual signed POST", () => {
  it.each(["foreign key", "tampered body", "unsigned"] as const)("refuses %s before admission or delivery", async failure => {
    const rawBody = JSON.stringify(askPayload());
    const req = signedRequest(rawBody, failure === "foreign key" ? foreignKeys.privateKey : keys.privateKey);
    if (failure === "tampered body") {
      req.headers.set("x-signature-ed25519", sign(null, Buffer.from("1791878400" + rawBody + " "), keys.privateKey).toString("hex"));
    } else if (failure === "unsigned") req.headers.delete("x-signature-ed25519");
    const response = await POST(req);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid request signature" });
    expectNoAdmissionOrWork();
  });

  it("verifies the signature before attempting to parse malformed JSON", async () => {
    const rawBody = '{"type":';
    const invalid = await POST(signedRequest(rawBody, foreignKeys.privateKey));
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ error: "invalid request signature" });
    const valid = await POST(signedRequest(rawBody));
    expect(valid.status).toBe(400);
    expect(await valid.json()).toEqual({ error: "malformed interaction body" });
    expectNoAdmissionOrWork();
  });

  it.each([undefined, null, "", " ", "unknown", "user789", "0", "0123", "-123", "1.5",
    "123\n", " 123", "123 ", "１２３", "1".repeat(21), 789, true, {}, ["789"]])(
    "denies signed guild and DM recipient %j before all work", async id => {
      for (const recipient of [{ member: { user: { id } } }, { member: undefined, user: { id } }]) {
        const response = await POST(signedRequest(JSON.stringify(askPayload(recipient))));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ type: 4, data: { flags: 64,
          content: botResearchMessages()("discordUsage") } });
        expectNoAdmissionOrWork();
      }
    },
  );

  it.each([null, {}, [], "invalid-member", { user: null }, { user: {} }, { user: { id: "" } },
    { user: { id: "invalid-user" } }, { user: { id: 789 } }])(
    "denies invalid present guild member %j despite a different valid top-level user", async member => {
      const response = await POST(signedRequest(JSON.stringify(askPayload({ member, user: { id: "790" } }))));
      expect(await response.json()).toEqual({ type: 4, data: { flags: 64,
        content: botResearchMessages()("discordUsage") } });
      expectNoAdmissionOrWork();
    },
  );

  it("denies a signed ask with neither recipient without echoing private input", async () => {
    const response = await POST(signedRequest(JSON.stringify(askPayload({ member: undefined }))));
    const body = await response.json();
    expect(body).toEqual({ type: 4, data: { flags: 64, content: botResearchMessages()("discordUsage") } });
    expect(JSON.stringify(body)).not.toContain(question);
    expect(JSON.stringify(body)).not.toContain(token);
    expectNoAdmissionOrWork();
  });

  it.each([
    { name: "guild", recipient: { member: { user: { id: "789" } }, user: { id: "790" } }, userId: "789",
      preferenceKey: "keryx:bot-answer-language:v1:373c5389f8b63582eee341e5dfdffc0cd86943e6a9f1c41aa7ba2fabd843a445" },
    { name: "DM", recipient: { member: undefined, user: { id: "790" } }, userId: "790",
      preferenceKey: "keryx:bot-answer-language:v1:dcb60ce937d912baa9e24eeb9d388a559959b6152292ebc310dcedd720bfc089" },
  ])("preserves normal $name admission and captures after without running it", async ({ name, recipient, userId, preferenceKey }) => {
    const read = vi.fn(), write = vi.fn();
    // Unavailable metadata cannot grant more work or block an otherwise valid ask.
    if (name === "DM") read.mockRejectedValue(new Error("Synthetic unknown preference capability"));
    else read.mockResolvedValue(null);
    mocks.db.mockResolvedValue({ getSyncState: read, setSyncState: write });
    const response = await POST(signedRequest(JSON.stringify(askPayload(recipient))));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(mocks.admission).toHaveBeenCalledExactlyOnceWith({ kind: "bot", platform: "discord", userId });
    expect(mocks.after).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.db).toHaveBeenCalledExactlyOnceWith();
    expect(read).toHaveBeenCalledExactlyOnceWith(preferenceKey);
    if (name === "DM") await expect(read.mock.results[0].value).rejects.toThrow("Synthetic unknown preference capability");
    else await expect(read.mock.results[0].value).resolves.toBe(null);
    expect(write).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves sponsored refusal for a valid recipient without scheduling research", async () => {
    const read = vi.fn().mockResolvedValue("vi"), write = vi.fn();
    mocks.db.mockResolvedValue({ getSyncState: read, setSyncState: write });
    mocks.admission.mockResolvedValue(Response.json({ error: "sponsored_rate_limit" }, { status: 429 }));
    const response = await POST(signedRequest(JSON.stringify(askPayload())));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ type: 4, data: { flags: 64,
      content: botResearchMessages(question, "vi")("sponsoredLimited") } });
    expect(JSON.stringify(body)).not.toContain(question);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(mocks.admission).toHaveBeenCalledExactlyOnceWith({ kind: "bot", platform: "discord", userId: "789" });
    expect(mocks.db).toHaveBeenCalledExactlyOnceWith();
    expect(read).toHaveBeenCalledExactlyOnceWith("keryx:bot-answer-language:v1:373c5389f8b63582eee341e5dfdffc0cd86943e6a9f1c41aa7ba2fabd843a445");
    await expect(read.mock.results[0].value).resolves.toBe("vi");
    expect(write).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves Ping and the existing private unsupported-command response", async () => {
    const ping = await POST(signedRequest(JSON.stringify({ type: 1 })));
    expect(await ping.json()).toEqual({ type: 1 });
    const unsupported = await POST(signedRequest(JSON.stringify(askPayload({ data: { name: "other", options: [] } }))));
    expect(await unsupported.json()).toEqual({ type: 4, data: { flags: 64,
      content: botResearchMessages()("discordUsage") } });
    expectNoAdmissionOrWork();
  });
});
