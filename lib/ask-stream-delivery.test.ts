import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), deps: vi.fn(), run: vi.fn(), save: vi.fn(), defaults: vi.fn(), complete: vi.fn() }));
vi.mock("./auth", () => ({ getSession: mocks.session }));
vi.mock("./agent", () => ({ getAgentDeps: mocks.deps }));
vi.mock("./agent/run-agent", () => ({ runAgent: mocks.run }));
vi.mock("./db", () => ({ getDb: async () => ({ runPrivacyActive: true, runPrivacy: { defaults: mocks.defaults, creationReady: async () => {} } }) }));
vi.mock("./activation", () => ({ recordActivationEvent: async () => {} }));
vi.mock("./sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("./research/availability", () => ({ readResearchAvailability: () => ({ state: "not-paused" }) }));
vi.mock("./run-claims/hosted-delivery", () => ({ hostedRunClaimsEnabled: () => true,
  prepareHostedRunClaim: async () => ({ complete: mocks.complete }) }));
vi.mock("./config", () => ({ config: { baseUrl: "https://synthetic.example", networkId: "eip155:5042002",
  profile: { name: "arcTestnet", networkId: "eip155:5042002" }, botKey: "", defaultBudget: 0,
  anonMaxBudget: 0.02, sessionAskMaxBudget: 0.05, jwtSecret: "synthetic-document-key-123456789012345" } }));
import { POST } from "../app/api/ask/route";
import { issuePrivateDocument, PRIVATE_DOCUMENT_HEADER } from "./run-claims/web-document";
import { config } from "./config";

const owner = `0x${"a".repeat(40)}`;
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue(null); mocks.defaults.mockResolvedValue("public");
  mocks.deps.mockResolvedValue({ engine: { name: "synthetic" }, gateway: { mode: "offline" },
    db: { saveQueryRun: mocks.save, listQueryRunsByAsker: async () => [] } });
  mocks.run.mockImplementation(async function* (input) { return { id: input.queryId, question: input.originalQuestion ?? input.question,
    answer: "Synthetic answer", budget: 0, engine: "synthetic", totalSpent: 0, totalToCreators: 0,
    subClaims: [], citations: [], decisions: [], trace: [] }; });
  mocks.complete.mockResolvedValue({ status: "unavailable" });
});
function request(visibility?: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://synthetic.example/api/ask", { method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ question: "Synthetic original", budget: 0, ...(visibility ? { visibility } : {}) }) });
}
function frames(text: string) {
  return text.split("\n\n").filter(frame => frame.startsWith("event:")).map(frame => ({
    event: frame.split("\n")[0].slice(7), data: JSON.parse(frame.split("\n")[1].slice(6)),
  }));
}
it.each(["public", "unlisted"])("binds the early %s report reference to the same saved result", async visibility => {
  const response = await POST(request(visibility));
  const text = await response.text(), events = frames(text);
  expect(text.startsWith(": connected\n\n")).toBe(true);
  const meta = events.find(frame => frame.event === "meta")!.data;
  const done = events.find(frame => frame.event === "done")!.data;
  expect(meta).toMatchObject({ reportId: done.id, visibility });
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: meta.reportId }), { visibility });
});
it("does not disclose a link-readable recovery reference for private owner research", async () => {
  mocks.session.mockResolvedValue({ address: owner });
  const events = frames(await (await POST(request("private"))).text());
  expect(events.find(frame => frame.event === "meta")!.data).not.toHaveProperty("reportId");
});
it("does not expose a public recovery reference on the anonymous private-claim transport", async () => {
  const proof = issuePrivateDocument("n".repeat(43), { origin: config.baseUrl, network: config.networkId }, config.jwtSecret);
  const events = frames(await (await POST(request(undefined, { Origin: config.baseUrl, "Sec-Fetch-Site": "same-origin", [PRIVATE_DOCUMENT_HEADER]: proof }))).text());
  expect(events.find(frame => frame.event === "meta")!.data).not.toHaveProperty("reportId");
});
