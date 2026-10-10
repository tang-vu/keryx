import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ deps: vi.fn(), run: vi.fn(), activation: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.deps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.run }));
vi.mock("@/lib/activation", () => ({ recordActivationEvent: mocks.activation }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
import { POST } from "../../app/api/ask/route";
afterEach(() => vi.unstubAllEnvs());
it("enabled anonymous web cannot start research on an analytics-allowed document before protected-document admission exists", async () => {
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
  const response = await POST(new NextRequest("https://synthetic.example/api/ask", { method: "POST", body: JSON.stringify({ question: "Synthetic private web", budget: 0 }) }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "private_research_document_required" });
  expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.activation).not.toHaveBeenCalled();
});
