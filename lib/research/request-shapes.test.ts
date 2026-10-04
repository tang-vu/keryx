import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ collectRun: vi.fn(), runAgent: vi.fn(), getAgentDeps: vi.fn() }));
vi.mock("@/lib/config", async original => { const actual = await original<typeof import("../config")>(); return { ...actual, config: { ...actual.config, sellerAddress: "0x1111111111111111111111111111111111111111" } }; });
vi.mock("@/lib/agent", () => ({ collectRun: calls.collectRun, getAgentDeps: calls.getAgentDeps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: calls.runAgent }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null), clientIp: () => "fixture" }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: vi.fn(async () => null) }));
import { POST as chat } from "@/app/api/v1/chat/completions/route";
import { POST as ask } from "@/app/api/ask/route";
import type { QueryRun } from "../types";
import { lastUserQuestion, validChatMessages } from "../openai-compat";

const request = (body: unknown) => new NextRequest("http://localhost/api/fixture", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => vi.clearAllMocks());

describe("research request shape admission", () => {
  it.each([null, [], "question", 4, true])("rejects non-object body %j before runners", async body => {
    const chatResponse = await chat(request(body));
    expect(chatResponse.status).toBe(400);
    expect(await chatResponse.json()).toMatchObject({ error: { type: "invalid_request_error", code: "invalid_request", message: expect.any(String) } });
    const response = await ask(request(body));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "request body must be a JSON object" });
    expect(calls.collectRun).not.toHaveBeenCalled(); expect(calls.runAgent).not.toHaveBeenCalled(); expect(calls.getAgentDeps).not.toHaveBeenCalled();
  });
  it.each([undefined, [], [null], [3], ["bad"], [false], [{ role: "user" }], [{ role: "user", content: [null] }]])("rejects malformed messages %j", async messages => {
    const response = await chat(request({ messages }));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { type: "invalid_request_error", code: "invalid_request" } });
    expect(calls.collectRun).not.toHaveBeenCalled(); expect(calls.getAgentDeps).not.toHaveBeenCalled();
  });
  it.each(["text question", [{ type: "text", text: "text question" }]])("retains valid content %j", content => {
    const messages = [{ role: "user", content }];
    expect(validChatMessages(messages)).toBe(true);
    expect(lastUserQuestion(messages)).toBe("text question");
  });
  it.each(["text question", [{ type: "text", text: "text question" }]])("admits valid content to the research runner %j", async content => {
    const run: QueryRun = { id: "valid-shape", question: "text question", budget: 0.03, engine: "fixture", subClaims: [],
      decisions: [], citations: [], answer: "Fixture answer", totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-02", paymentMode: "offline" };
    calls.collectRun.mockResolvedValue(run);
    const response = await chat(request({ messages: [{ role: "user", content }] }));
    expect(response.status).toBe(200);
    expect(calls.collectRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ question: "text question" }));
    expect((await response.json()).choices[0].message.content).toBe("Fixture answer");
  });
  it("rejects malformed previous turns even when the final question is usable", async () => {
    expect((await chat(request({ messages: [null, { role: "user", content: "usable" }] }))).status).toBe(400);
    expect(calls.collectRun).not.toHaveBeenCalled();
  });
});
