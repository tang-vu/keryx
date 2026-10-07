import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceStep } from "../types";

const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(), collectRun: vi.fn(), getAgentDeps: vi.fn(), provider: vi.fn(),
  saveQueryRun: vi.fn(), recordActivationEvent: vi.fn(), pay: vi.fn(), payCitation: vi.fn(), network: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.getAgentDeps, collectRun: mocks.collectRun }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.runAgent }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(async () => ({ saveQueryRun: mocks.saveQueryRun, recordActivationEvent: mocks.recordActivationEvent })) }));
vi.mock("@/lib/llm", () => ({ resolveModelChoice: vi.fn(() => undefined) }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: vi.fn(async () => null) }));
vi.mock("@/lib/config", async () => {
  const { ARC_MAINNET_PROFILE } = await import("../arc-network-profile");
  return { config: { profile: ARC_MAINNET_PROFILE, sellerAddress: "0x1111111111111111111111111111111111111111",
    baseUrl: "https://keryx.invalid", defaultBudget: 0.02, anonMaxBudget: 0.05, a2aMaxBudget: 0.1,
    sessionAskMaxBudget: 0.25, botKey: "" } };
});

import { POST as ask } from "@/app/api/ask/route";
import { POST as completion } from "@/app/api/v1/chat/completions/route";
import { createRemoteMcpServer } from "../mcp/remote-server";
import { boundedResearchPlan } from "../llm/research-plan";
import { MAX_RESEARCH_TARGETS } from "../llm/research-target-limits";
import { ReasoningOutputValidationError, ReasoningOutputLimitError } from "../llm/reasoning-engine";

const RAW_PROVIDER_OUTPUT = "RAW_PROVIDER_PLAN_NOT_CALLER_TEXT";
const step: TraceStep = { phase: "decompose", message: "Preparing a bounded research plan", ts: 1 };
const surfaces = ["web", "openai-json", "openai-stream", "mcp"] as const;
type Surface = typeof surfaces[number];

// The original caller asks for four qualified subjects. The refusal may offer at
// most three bounded excerpts; it must not silently research a rewritten request.
const qualification = " keeping all original source qualifications and version constraints".repeat(4);
const englishQuestion = ["Atlas v3 official API limits", "Boreal v7 deployment guarantees", "Cedar v2 snapshot consistency", "Delta v4 recovery limits"]
  .map(subject => `Compare ${subject} at https://docs.example.invalid/original?private-selector=caller-url-token#section${qualification}`)
  .join("; ");
const vietnameseQuestion = "So sánh Atlas v3 theo tài liệu chính thức tại https://docs.example.invalid/v3#limits; Giữ phiên bản Boreal v7 và các điều kiện nguồn gốc";

function request(path: string, body: object) {
  return new NextRequest(`https://keryx.invalid${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function completionRequest(question: string, stream: boolean) {
  return request("/api/v1/chat/completions", { model: "keryx", messages: [{ role: "user", content: question }], budget: 0.02, stream });
}
function packets(wire: string) {
  return wire.trim().split("\n\n").map(packet => ({ event: /^event: (.+)$/m.exec(packet)?.[1],
    data: JSON.parse(/^data: (.+)$/m.exec(packet)![1]) as Record<string, unknown> }));
}

async function refusal(surface: Surface, question: string): Promise<{ message: string; wire: string }> {
  if (surface === "mcp") {
    const server = createRemoteMcpServer({ budgetCap: 0.03, clientChannel: "other" });
    const client = new Client({ name: "planning-refusal-fixture", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const result = await client.callTool({ name: "research", arguments: { question, budget: 0.02 } });
      expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([{ type: "text", text: expect.stringMatching(/^Keryx research failed: /) }]);
      return { message: (result.content as { type: "text"; text: string }[])[0].text, wire: JSON.stringify(result) };
    } finally { await client.close(); await server.close(); }
  }
  if (surface === "openai-json") {
    const response = await completion(completionRequest(question, false));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({ error: { message: expect.any(String), type: "invalid_request_error", code: "research_plan_refinement_required" } });
    return { message: body.error.message, wire: JSON.stringify(body) };
  }
  const response = surface === "web"
    ? await ask(request("/api/ask", { question, budget: 0.02 }))
    : await completion(completionRequest(question, true));
  expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("text/event-stream");
  const wire = await response.text();
  expect(wire).not.toContain("data: [DONE]");
  const events = packets(wire);
  if (surface === "web") {
    expect(events.map(event => event.event)).toEqual(["meta", "step", "error"]);
    expect(events[1].data).toEqual(step);
    expect(events[2].data).toEqual({ message: expect.any(String) });
    return { message: events[2].data.message as string, wire };
  }
  const chunks = events.map(event => event.data as { choices: Array<{ delta: { content?: string; reasoning_content?: string; role?: string }; finish_reason: unknown }>; keryx?: unknown });
  expect(chunks).toHaveLength(3);
  expect(chunks[0].choices[0].delta).toEqual({ role: "assistant" });
  expect(chunks[1].choices[0].delta.reasoning_content).toContain("Preparing a bounded research plan");
  for (const chunk of chunks) { expect(chunk.choices[0].finish_reason).toBeNull(); expect(chunk.keryx).toBeUndefined(); }
  const message = chunks[2].choices[0].delta.content!;
  expect(message).toMatch(/^\n\n\[keryx error\] /);
  return { message, wire };
}

function singleDispatch(surface: Surface, question: string) {
  const runner = surface === "web" ? mocks.runAgent : mocks.collectRun;
  expect(runner).toHaveBeenCalledOnce();
  expect(runner).toHaveBeenCalledWith(expect.objectContaining({ question, budget: 0.02 }), ...(surface === "web" || surface === "openai-stream" ? [expect.any(Object)] : []));
  expect(surface === "web" ? mocks.collectRun : mocks.runAgent).not.toHaveBeenCalled();
  expect(mocks.provider).toHaveBeenCalledExactlyOnceWith(question);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.provider.mockResolvedValue({ status: "complete", claims: Array.from({ length: MAX_RESEARCH_TARGETS + 1 }, (_, index) => `${RAW_PROVIDER_OUTPUT}-${index}`) });
  mocks.recordActivationEvent.mockResolvedValue(undefined);
  mocks.getAgentDeps.mockResolvedValue({ db: { saveQueryRun: mocks.saveQueryRun, recordActivationEvent: mocks.recordActivationEvent },
    engine: { name: "local-planning-fixture" }, gateway: { mode: "offline", pay: mocks.pay, payCitation: mocks.payCitation } });
  mocks.runAgent.mockImplementation(async function* (params: { question: string }) {
    yield step;
    await boundedResearchPlan(params.question, () => mocks.provider(params.question));
    throw new Error("Fixture expected a terminal planning refusal");
  });
  mocks.collectRun.mockImplementation(async (params: { question: string }, options?: { onStep?: (step: TraceStep) => void }) => {
    options?.onStep?.(step);
    await boundedResearchPlan(params.question, () => mocks.provider(params.question));
    throw new Error("Fixture expected a terminal planning refusal");
  });
  mocks.network.mockImplementation(() => { throw new Error("Unexpected network request in planning refusal fixture"); });
  vi.stubGlobal("fetch", mocks.network);
});
afterEach(() => {
  vi.unstubAllGlobals();
  expect(mocks.saveQueryRun).not.toHaveBeenCalled();
  expect(mocks.recordActivationEvent.mock.calls.map(([event]) => event)).not.toContain("reader_answer_completed");
  expect(mocks.pay).not.toHaveBeenCalled(); expect(mocks.payCitation).not.toHaveBeenCalled();
  expect(mocks.network).not.toHaveBeenCalled();
});

describe("terminal planning refusals reach the original caller", () => {
  it.each(surfaces)("%s retains an observed planning ceiling without retries, receipts or private output", async surface => {
    mocks.provider.mockRejectedValue(new ReasoningOutputLimitError(2048));
    const { message, wire } = await refusal(surface, englishQuestion);
    singleDispatch(surface, englishQuestion);
    expect(message).toContain("2,048-token output limit");
    expect(message).not.toContain("saved evidence");
    expect(wire).not.toContain("503");
    expect(wire).not.toContain(RAW_PROVIDER_OUTPUT);
  });
  it.each(surfaces)("%s preserves qualified caller excerpts without a completed report or retry", async surface => {
    const { message, wire } = await refusal(surface, englishQuestion);
    singleDispatch(surface, englishQuestion);
    expect(message).toContain("Atlas v3 official API limits");
    expect(message).toContain("Boreal v7 deployment guarantees");
    expect(message).toContain("Cedar v2 snapshot consistency");
    expect(message).not.toContain("Delta v4 recovery limits");
    const choices = message.split("\n").filter(line => /^[1-3]\. /.test(line));
    expect(choices).toHaveLength(3);
    for (const choice of choices) expect(choice.slice(3).length).toBeLessThanOrEqual(241);
    expect(message.length).toBeLessThan(1_500);
    expect(message).toContain("keeping the original source URLs/versions and qualifications");
    expect(message).toContain("not a new question or an automatic retry");
    for (const privateOrSuccess of [RAW_PROVIDER_OUTPUT, "caller-url-token", "https://docs.example.invalid", "settledPayments", "paymentAttempts", "dispatchUrl", "creatorsPaid"])
      expect(wire).not.toContain(privateOrSuccess);
  });

  it.each(surfaces)("%s keeps Vietnamese refinement guidance tied to that caller", async surface => {
    const { message, wire } = await refusal(surface, vietnameseQuestion);
    singleDispatch(surface, vietnameseQuestion);
    expect(message).toContain("So sánh Atlas v3 theo tài liệu chính thức");
    expect(message).toContain("Giữ phiên bản Boreal v7");
    expect(message).toContain("giữ các URL/phiên bản");
    expect(message).toContain("không phải câu hỏi mới hay lần thử tự động");
    expect(message).not.toContain("Cedar"); expect(message).not.toContain("Delta");
    expect(wire).not.toContain(RAW_PROVIDER_OUTPUT);
  });

  it.each(surfaces)("%s withholds raw output-validation exceptions while offering caller refinement", async surface => {
    mocks.provider.mockRejectedValue(new ReasoningOutputValidationError(RAW_PROVIDER_OUTPUT));
    const { message, wire } = await refusal(surface, englishQuestion);
    singleDispatch(surface, englishQuestion);
    expect(message).toContain("Atlas v3 official API limits");
    expect(message).toContain("keeping the original source URLs/versions and qualifications");
    expect(message).toContain("not a new question or an automatic retry");
    expect(wire).not.toContain(RAW_PROVIDER_OUTPUT);
    expect(wire).not.toContain("caller-url-token");
  });

  it.each(surfaces)("%s preserves unrelated upstream-error behavior without planning guidance", async surface => {
    const error = new Error("Synthetic upstream unavailable");
    mocks.provider.mockRejectedValue(error);
    if (surface === "openai-json") {
      await expect(completion(completionRequest(englishQuestion, false))).rejects.toBe(error);
    } else {
      const { message } = await refusal(surface, englishQuestion);
      expect(message).toContain(error.message);
      expect(message).not.toContain("Atlas");
      expect(message).not.toContain("refinement");
      expect(message).not.toContain("automatic retry");
    }
    singleDispatch(surface, englishQuestion);
  });
});
