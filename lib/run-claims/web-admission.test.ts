import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ deps: vi.fn(), run: vi.fn(), activation: vi.fn(), prepare: vi.fn(), complete: vi.fn(), save: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.deps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.run }));
vi.mock("@/lib/activation", () => ({ recordActivationEvent: mocks.activation }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ hostedRunClaimsEnabled: () => process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED === "true", prepareHostedRunClaim: mocks.prepare }));
import { POST } from "../../app/api/ask/route";
import { config } from "../config";
import { issuePrivateDocument } from "./web-document";
const originalSecret = Object.getOwnPropertyDescriptor(config, "jwtSecret")!, originalBaseUrl = Object.getOwnPropertyDescriptor(config, "baseUrl")!;
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue(null); mocks.save.mockResolvedValue(undefined);
  mocks.activation.mockResolvedValue(undefined); mocks.prepare.mockResolvedValue({ complete: mocks.complete });
  Object.defineProperty(config, "jwtSecret", { ...originalSecret, value: "synthetic-document-session-key-1234567890" });
  Object.defineProperty(config, "baseUrl", { ...originalBaseUrl, value: "http://localhost:3939" });
  mocks.deps.mockResolvedValue({ engine: { name: "heuristic" }, gateway: { mode: "offline" }, db: { saveQueryRun: mocks.save } });
  mocks.run.mockImplementation(async function* (options) { return { id: options.queryId, createdAt: new Date().toISOString(), question: options.question,
    budget: 0, answer: "Synthetic completed research", decisions: [], citations: [], trace: [], paymentMode: "offline", totalSpent: 0, totalToCreators: 0 }; });
  mocks.complete.mockImplementation(async run => ({ version: 1, runId: run.id, status: "unavailable" }));
});
afterEach(() => { Object.defineProperty(config, "jwtSecret", originalSecret); Object.defineProperty(config, "baseUrl", originalBaseUrl); });
afterEach(() => vi.unstubAllEnvs());
it("enabled anonymous web cannot start research on an analytics-allowed document without protected-document admission", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
  const response = await POST(new NextRequest("https://synthetic.example/api/ask", { method: "POST", body: JSON.stringify({ question: "Synthetic private web", budget: 0 }) }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "private_research_document_required" });
  expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.activation).not.toHaveBeenCalled();
});
const request = () => new NextRequest(config.baseUrl + "/api/ask", { method: "POST", headers: { Origin: config.baseUrl, "Sec-Fetch-Site": "same-origin",
  "X-Keryx-Private-Document": issuePrivateDocument("n".repeat(43), { origin: config.baseUrl, network: config.networkId }, config.jwtSecret) },
  body: JSON.stringify({ question: "Synthetic private web", budget: 0 }) });
it("admission failure occurs before providers, activation or persistence", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); mocks.prepare.mockRejectedValue(new Error("Synthetic unavailable domain"));
  const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "claims_unavailable" });
  expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.activation).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("prepares before research, saves unchanged original before private completion, and sends the separate packet after done", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
  const response = await POST(request()), text = await response.text();
  expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.deps.mock.invocationCallOrder[0]);
  expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]);
  const run = mocks.save.mock.calls[0][0]; expect(run).not.toHaveProperty("delivery"); expect(run).not.toHaveProperty("claimUrl");
  expect(run).not.toHaveProperty("asker"); expect(text.indexOf("event: done")).toBeLessThan(text.indexOf("event: private-run-claim"));
  expect(text).toContain("Synthetic completed research"); expect(text).not.toContain("event: error");
  expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
it("owned completions retain attribution and never prepare an anonymous credential", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true"); mocks.session.mockResolvedValue({ address: "0x" + "a".repeat(40) });
  mocks.deps.mockResolvedValue({ engine: { name: "heuristic" }, gateway: { mode: "offline" }, db: { saveQueryRun: mocks.save, listQueryRunsByAsker: async () => [] } });
  const response = await POST(request()), text = await response.text();
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.save.mock.calls[0][0]).toMatchObject({ asker: "0x" + "a".repeat(40), askerFunded: false });
  expect(text).not.toContain("event: private-run-claim");
});
