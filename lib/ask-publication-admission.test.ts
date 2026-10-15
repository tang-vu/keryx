import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), deps: vi.fn(), run: vi.fn(), save: vi.fn(), defaults: vi.fn(),
  ready: vi.fn(), activation: vi.fn(), parent: vi.fn(), prepare: vi.fn(), complete: vi.fn(), claimsEnabled: true }));
const origin = "https://synthetic.example", alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
vi.mock("./auth", () => ({ getSession: mocks.session }));
vi.mock("./agent", () => ({ getAgentDeps: mocks.deps }));
vi.mock("./agent/run-agent", () => ({ runAgent: mocks.run }));
vi.mock("./db", () => ({ getDb: async () => ({ runPrivacyActive: true, runPrivacy: { defaults: mocks.defaults, creationReady: mocks.ready } }) }));
vi.mock("./history/read-dispatch", () => ({ resolveDispatch: mocks.parent }));
vi.mock("./activation", () => ({ recordActivationEvent: mocks.activation }));
vi.mock("./rate-limit", () => ({ clientIp: () => "synthetic", checkRateLimit: async () => null }));
vi.mock("./sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("./research/availability", () => ({ readResearchAvailability: () => ({ state: "not-paused" }) }));
vi.mock("./run-claims/hosted-delivery", () => ({ hostedRunClaimsEnabled: () => mocks.claimsEnabled, prepareHostedRunClaim: mocks.prepare }));
vi.mock("./config", () => ({ config: { baseUrl: "https://synthetic.example", networkId: "eip155:5042002",
  profile: { name: "arcTestnet", networkId: "eip155:5042002" }, botKey: "", defaultBudget: 0.01, anonMaxBudget: 0.02,
  sessionAskMaxBudget: 0.05, jwtSecret: "synthetic-private-document-key-1234567890" } }));
import { POST } from "../app/api/ask/route";
import { config } from "./config";
import { issuePrivateDocument, PRIVATE_DOCUMENT_HEADER } from "./run-claims/web-document";

function request(patch: object = {}, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ question: "Synthetic public research", budget: 0, ...patch }) });
}
beforeEach(() => {
  Object.assign(config, { botKey: "" });
  vi.clearAllMocks(); mocks.claimsEnabled = true; mocks.session.mockResolvedValue(null); mocks.defaults.mockResolvedValue("public");
  mocks.ready.mockResolvedValue(undefined);
  mocks.parent.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined);
  mocks.deps.mockResolvedValue({ engine: { name: "synthetic" }, gateway: { mode: "offline" },
    db: { saveQueryRun: mocks.save, listQueryRunsByAsker: async () => [] } });
  mocks.run.mockImplementation(async function* (input) { return { id: input.queryId, createdAt: "2026-10-15T00:00:00.000Z",
    question: input.originalQuestion ?? input.question, answer: "Synthetic answer", budget: 0, engine: "synthetic",
    totalSpent: 0, totalToCreators: 0, subClaims: [], citations: [], decisions: [], trace: [] }; });
  mocks.complete.mockImplementation(async run => ({ version: 1, runId: run.id, status: "unavailable" }));
  mocks.prepare.mockResolvedValue({ complete: mocks.complete });
});

it("runs ordinary anonymous public research with claims enabled without issuing a private credential", async () => {
  const response = await POST(request({ visibility: "public" }, { "X-Keryx-Expected-Wallet": "anonymous" }));
  const text = await response.text(); expect(response.status).toBe(200);
  expect(text).toContain('"visibility":"public"'); expect(text).toContain("event: done");
  expect(text).not.toContain("event: private-run-claim"); expect(text).not.toContain("event: error");
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ answer: "Synthetic answer" }), { visibility: "public" });
});
it.each(["", null, "PUBLIC", false])("refuses malformed visibility before providers, activation and persistence", async visibility => {
  const response = await POST(request({ visibility })); expect(response.status).toBe(400);
  expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.activation).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("refuses an unavailable creation writer before providers, activation and persistence", async () => {
  mocks.ready.mockRejectedValue(new Error("privacy_unavailable"));
  const response = await POST(request({ visibility: "public" })); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: "visibility_unavailable" });
  expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.activation).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("requires verified owner access for Private and binds the saved default to private response metadata", async () => {
  expect((await POST(request({ visibility: "private" }))).status).toBe(401);
  expect(mocks.deps).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ address: alice }); mocks.defaults.mockResolvedValue("private");
  const response = await POST(request()), text = await response.text();
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(text).toContain(`"visibilityOwner":"${alice}"`);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ asker: alice }), { visibility: "private" });
});
it("refuses an account change or a more public hidden-parent follow-up before any research", async () => {
  mocks.session.mockResolvedValue({ address: bob });
  expect((await POST(request({ visibility: "public" }, { "X-Keryx-Expected-Wallet": alice }))).status).toBe(409);
  mocks.session.mockResolvedValue({ address: alice });
  mocks.parent.mockResolvedValue({ run: { id: "synthetic-parent", question: "Synthetic hidden context" }, visibility: "private" });
  expect((await POST(request({ visibility: "public", parentId: "synthetic-parent" }))).status).toBe(409);
  expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("still rejects invalid or disabled protected claim delivery before inference", async () => {
  const invalid = await POST(request({ visibility: "public" }, { Origin: origin, [PRIVATE_DOCUMENT_HEADER]: "invalid" }));
  expect(invalid.status).toBe(503); expect(await invalid.json()).toEqual({ error: "private_research_document_required" });
  mocks.claimsEnabled = false;
  const disabled = await POST(request({ visibility: "public" }, { [PRIVATE_DOCUMENT_HEADER]: "invalid" }));
  expect(disabled.status).toBe(503); expect(await disabled.json()).toEqual({ error: "claims_unavailable" });
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(["signed-in", "bot"])("validates a present protected-document header for %s callers too", async caller => {
  if (caller === "signed-in") mocks.session.mockResolvedValue({ address: alice });
  else Object.assign(config, { botKey: "synthetic-bot" });
  const req = new NextRequest(`${origin}/api/ask${caller === "bot" ? "?bot=synthetic-bot" : ""}`, {
    method: "POST", headers: { Origin: origin, [PRIVATE_DOCUMENT_HEADER]: "invalid" },
    body: JSON.stringify({ question: "Synthetic public research", visibility: "public", budget: 0 }),
  });
  const response = await POST(req); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "private_research_document_required" });
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.deps).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("retains the protected claim flow and saves the exact original before the separate private transport", async () => {
  const ticket = issuePrivateDocument("n".repeat(43), { origin, network: "eip155:5042002" }, "synthetic-private-document-key-1234567890");
  const response = await POST(request({ visibility: "unlisted" }, { Origin: origin, "Sec-Fetch-Site": "same-origin", [PRIVATE_DOCUMENT_HEADER]: ticket }));
  const text = await response.text(); expect(response.status).toBe(200);
  expect(text.indexOf("event: private-run-claim")).toBeGreaterThan(text.indexOf("event: done"));
  expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]);
  expect(mocks.save.mock.calls[0][0]).not.toHaveProperty("visibility");
  expect(mocks.save.mock.calls[0][0]).not.toHaveProperty("delivery");
});
