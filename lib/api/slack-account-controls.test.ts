import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(), presentation: vi.fn(), collect: vi.fn(), admission: vi.fn(), claim: vi.fn(), enabled: vi.fn(), after: vi.fn(),
  config: { baseUrl: "https://slack-controls.example", slackSigningSecret: "fixture-signing-secret",
    sellerAddress: "fixture-treasury", defaultBudget: 0.05, anonMaxBudget: 0.025 },
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

import { POST } from "../../app/api/slack/commands/route";
import { helpText, slackAccountLinkingUnavailable } from "../slack/ask-command";
import { botControlsCatalogues } from "../bots/language";
import { botResearchMessages } from "../bots/research-messages";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.slackSigningSecret = "fixture-signing-secret";
  mocks.config.sellerAddress = "fixture-treasury";
  mocks.db.mockRejectedValue(new Error("Account controls must not open storage"));
  mocks.presentation.mockResolvedValue({ language: "en", input: { presentationLanguage: "en" } });
  mocks.collect.mockRejectedValue(new Error("Research callback must not execute in this fixture"));
  mocks.admission.mockResolvedValue(null);
  mocks.enabled.mockReturnValue(false);
  fetchMock = vi.fn(async () => { throw new Error("Outbound delivery forbidden in this fixture"); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Synthetic fixtures exercise the real raw-body HMAC verifier; no verifier mock or outbound call. */
function signedRequest(overrides: Record<string, string> = {}, options: { timestamp?: number; tamper?: boolean } = {}) {
  const body = new URLSearchParams({ command: "/keryx", text: "link", team_id: "T123", user_id: "U123",
    channel_id: "C456", channel_name: "general", response_url: "https://hooks.slack.com/commands/fixture/private",
    ...overrides }).toString();
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = "v0=" + createHmac("sha256", mocks.config.slackSigningSecret)
    .update(`v0:${timestamp}:${body}`).digest("hex");
  return new NextRequest("https://slack-controls.example/api/slack/commands", { method: "POST",
    body: options.tamper ? body + "&text=changed-after-signing" : body,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature } });
}

function expectNoEffects() {
  expect(mocks.presentation).not.toHaveBeenCalled();
  expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.admission).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.collect).not.toHaveBeenCalled();
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
}

async function expectUnavailable(req: NextRequest) {
  const response = await POST(req);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ response_type: "ephemeral", text: slackAccountLinkingUnavailable });
  expectNoEffects();
}

describe("signed Slack account-control refusal", () => {
  it.each(["link", "unlink", "whoami", "/link", "/unlink", "/whoami"])
    ("privately refuses the reserved control %s before sponsored admission", async text => {
      await expectUnavailable(signedRequest({ text }));
    });

  it.each(["/link", "/unlink", "/whoami"])("privately refuses direct %s even with conflicting text", async command => {
    for (const text of ["", "fixture-secret", "/language es", "What is x402?"]) {
      await expectUnavailable(signedRequest({ command, text }));
    }
  });

  it.each([
    ["bare token", "link fixture-secret"],
    ["token URL", "/link https://secret.example/?token=fixture-secret"],
    ["unknown flag", "unlink --confirm=fixture-secret"],
    ["multiline mention", "/unlink\n<@U123> fixture-secret"],
    ["malformed object", "whoami\t{broken:fixture-secret}"],
    ["long argument", "/whoami " + "fixture-secret".repeat(1000)],
  ])("refuses %s arguments without echoing them", async (_label, text) => {
    await expectUnavailable(signedRequest({ text }));
  });

  it.each<Record<string, string>>([
    { team_id: "", user_id: "", channel_id: "", response_url: "" },
    { team_id: "unknown", user_id: "unknown", channel_name: "private-group", response_url: "https://secret.example/private" },
    { channel_id: "C456", channel_name: "general" },
    { channel_id: "G456", channel_name: "private-group" },
    { channel_id: "D456", channel_name: "directmessage" },
  ])("refuses privately without requiring a recipient binding or outbound URL: %j", async scope => {
    await expectUnavailable(signedRequest(scope));
  });

  it("refuses the control before treasury configuration or admission failure can change the response", async () => {
    mocks.config.sellerAddress = "";
    mocks.admission.mockRejectedValue(new Error("Admission must not run"));
    await expectUnavailable(signedRequest({ text: "/link fixture-secret" }));
  });

  it.each(["wrong signature", "tampered body", "stale signed body"])
    ("rejects %s before account-control handling", async failure => {
      const req = signedRequest({ text: "/link fixture-secret" }, {
        ...(failure === "tampered body" ? { tamper: true } : {}),
        ...(failure === "stale signed body" ? { timestamp: Math.floor(Date.now() / 1000) - 600 } : {}),
      });
      if (failure === "wrong signature") req.headers.set("x-slack-signature", "v0=" + "0".repeat(64));
      const response = await POST(req);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid request signature" });
      expectNoEffects();
    });

  it("keeps an unconfigured endpoint unavailable without handling account controls", async () => {
    const req = signedRequest();
    mocks.config.slackSigningSecret = "";
    const response = await POST(req);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "slack commands not configured" });
    expectNoEffects();
  });

  it.each(["What does whoami do?", "Explain the link between citations and rewards.",
    "How do I unlink an account?", "linking accounts safely", "unlinkable sources", "whoami?"])
    ("still admits ordinary research through controlled mocks: %s", async question => {
      const response = await POST(signedRequest({ text: question }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ response_type: "ephemeral", text: botResearchMessages(question)("dispatching") });
      expect(mocks.admission).toHaveBeenCalledExactlyOnceWith({ kind: "bot", platform: "slack", userId: "U123" });
      expect(mocks.after).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
      // Admission and scheduling are observed; the stored callback is never executed.
      expect(mocks.presentation).not.toHaveBeenCalled();
      expect(mocks.db).not.toHaveBeenCalled();
      expect(mocks.collect).not.toHaveBeenCalled();
      expect(mocks.claim).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

  it("resolves the scoped generation preference only in the owned callback", async () => {
    const question = "Explain x402 citations.";
    mocks.presentation.mockResolvedValue({ language: "vi", input: { presentationLanguage: "vi" } });
    mocks.claim.mockResolvedValue(null);
    mocks.collect.mockResolvedValue({ id: "fixture-run", question, budget: 0.025, engine: "heuristic", subClaims: [],
      decisions: [], citations: [], answer: "Synthetic fixture answer", totalSpent: 0, totalToCreators: 0,
      trace: [], createdAt: "2026-10-13T00:00:00.000Z", paymentMode: "offline" });
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    await POST(signedRequest({ text: question }));
    expect(mocks.presentation).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.presentation).toHaveBeenCalledExactlyOnceWith(question, { platform: "slack", scope: "T123", userId: "U123" });
    expect(mocks.collect).toHaveBeenCalledExactlyOnceWith({ question, presentationLanguage: "vi", budget: 0.025,
      queryId: expect.any(String), origin: "web", provenance: { version: 1, surface: "slack", ownershipMethod: "unknown" } });
    expect(mocks.db).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps preference lookup behind the existing private response-URL gate", async () => {
    mocks.enabled.mockReturnValue(true);
    await POST(signedRequest({ text: "Explain x402 citations.", response_url: "https://foreign.example/private" }));
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.presentation).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["", "help", "/help vi"])("preserves existing nested help semantics: %s", async text => {
    mocks.db.mockResolvedValue({ getSyncState: vi.fn(async () => null) });
    const response = await POST(signedRequest({ text }));
    expect(await response.json()).toEqual({ response_type: "ephemeral", text: helpText(text === "/help vi" ? "vi" : "en") });
    expect(mocks.admission).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["/language", "/keryx"])("preserves existing language semantics for %s", async command => {
    const read = vi.fn(async () => null);
    mocks.db.mockResolvedValue({ getSyncState: read });
    const response = await POST(signedRequest({ command, text: command === "/language" ? "" : "/language" }));
    expect(await response.json()).toEqual({ response_type: "ephemeral",
      text: botControlsCatalogues.en.languageCurrent.replace("{preference}", "auto") + "\n" + botControlsCatalogues.en.languageHelp });
    expect(read).toHaveBeenCalledTimes(1);
    expect(mocks.admission).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
