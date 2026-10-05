import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ collectRun: vi.fn() }));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collectRun }));
vi.mock("@/lib/llm", () => ({ resolveModelChoice: () => null }));
vi.mock("@/lib/config", async importOriginal => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, config: { ...actual.config, sellerAddress: "0x1111111111111111111111111111111111111111",
    defaultBudget: 0.05, anonMaxBudget: 0.03 } };
});
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("@/lib/openai-compat", async importOriginal => {
  const actual = await importOriginal<typeof import("./openai-compat")>();
  return { ...actual, buildCompletion: () => ({ id: "synthetic-routing-fixture" }) };
});
import { POST } from "../app/api/v1/chat/completions/route";

beforeEach(() => { vi.clearAllMocks(); mocks.collectRun.mockResolvedValue({}); });
it.each([0, undefined])("preserves explicit zero while clamping the default for OpenAI callers: %s", async budget => {
  const response = await POST(new NextRequest("https://keryx.cc/api/v1/chat/completions", { method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "Read public originals" }], budget }) }));
  expect(response.status).toBe(200);
  expect(mocks.collectRun).toHaveBeenCalledWith(expect.objectContaining({ budget: budget === 0 ? 0 : 0.03 }));
});
