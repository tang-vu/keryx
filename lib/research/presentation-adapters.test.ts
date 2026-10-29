import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { presentationRun, presentationQuestions } from "./presentation.test-fixture";
import { researchPresentationCatalogues } from "./presentation-messages";
import { presentationLanguages } from "./presentation-language";
import { buildCompletion, keryxMeta } from "../openai-compat";
import { openapiSpec } from "../openapi-spec";

const mocks = vi.hoisted(() => ({ collect: vi.fn(), deps: vi.fn(), admission: vi.fn(), verify: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collect, getAgentDeps: mocks.deps }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.admission }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: mocks.verify }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/llm", () => ({ resolveModelChoice: () => null }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ prepareHostedRunClaim: async () => null }));
vi.mock("@/lib/config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, sellerAddress: "0x1111111111111111111111111111111111111111",
    baseUrl: "https://presentation.example", botKey: "", defaultBudget: 0.05, anonMaxBudget: 0.025 } };
});
import { POST } from "../../app/api/v1/chat/completions/route";
import { createRemoteMcpServer, remoteResearchResult } from "../mcp/remote-server";
const locales = ["en", "vi", "pt", "es", "fr"] as const;
const preparedDeps = { db: {}, engine: { name: "synthetic-presentation" }, gateway: { mode: "offline" } };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.admission.mockResolvedValue(null); mocks.verify.mockResolvedValue(null);
  mocks.collect.mockImplementation(async (input: { question: string }) => presentationRun(input.question));
  mocks.deps.mockResolvedValue(preparedDeps);
  fetchMock = vi.fn(async () => { throw new Error("No external transport admitted"); }); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function request(language: unknown, stream = false, auth?: string) {
  return new NextRequest("https://presentation.example/api/v1/chat/completions", { method: "POST",
    headers: auth ? { authorization: `Bearer ${auth}` } : {}, body: JSON.stringify({ language, stream, budget: 0,
      messages: [{ role: "user", content: presentationQuestions.en }] }) });
}
it.each(locales.flatMap(language => [false, true].map(stream => [language, stream] as const)))
  ("API %s stream=%s applies labels only and preserves the existing machine/private envelope", async (language, stream) => {
    const response = await POST(request(language, stream)); expect(response.status).toBe(200);
    const wire = await response.text();
    const input = mocks.collect.mock.calls[0][0];
    expect(mocks.deps).toHaveBeenCalledExactlyOnceWith({ model: undefined });
    expect(mocks.collect.mock.calls[0][1]).toEqual({ deps: preparedDeps, onStep: expect.any(Function) });
    expect(input).toMatchObject({ question: presentationQuestions.en, budget: 0, provenance: { surface: "api", ownershipMethod: "unknown" } });
    for (const forbidden of ["language", "presentationLanguage", "answerLanguage", "requestedLanguage", "originalQuestion"])
      expect(input).not.toHaveProperty(forbidden);
    const run = presentationRun(), expected = keryxMeta(run);
    if (stream) {
      const body = wire; expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
      const chunks = body.split("\n\n").filter(part => part.startsWith("data: {")).map(part => JSON.parse(part.slice(6)));
      expect(chunks[0].choices[0].delta).toEqual({ role: "assistant" });
      const answer = chunks.find(chunk => typeof chunk.choices[0].delta.content === "string").choices[0].delta.content;
      expect(answer).toBe(buildCompletion(run, "keryx", language).choices[0].message.content);
      expect(chunks.at(-1)).toMatchObject({ object: "chat.completion.chunk", choices: [{ finish_reason: "stop", delta: {} }], keryx: expected });
      expect(chunks.at(-1)).not.toHaveProperty("language");
    } else {
      const body = JSON.parse(wire); expect(body.keryx).toEqual(expected);
      expect(body.choices[0].message.content.startsWith(run.answer)).toBe(true);
      expect(body.choices[0].message.content).toContain(researchPresentationCatalogues[language].citations);
      expect(body).not.toHaveProperty("language"); expect(body).not.toHaveProperty("answerLanguage");
    }
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
it.each(["de", "zh-Hans", "es-ES", null, {}, 3])("API rejects unsupported language %j before admission/provider calls with stable invalid_request code", async language => {
  const response = await POST(request(language)); expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { type: "invalid_request_error", code: "invalid_request",
    message: "language must be en, vi, pt, pt-BR, es or fr (generated labels only)" } });
  expect(mocks.admission).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  expect(mocks.deps).not.toHaveBeenCalled();
});
it.each(locales)("API %s language changes grant no authentication rights or different auth error fields", async language => {
  const response = await POST(request(language, false, "kx_live_isolated-invalid"));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: { message: "invalid or revoked api key", type: "invalid_request_error", code: "invalid_api_key" } });
  expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.admission).not.toHaveBeenCalled();
  expect(mocks.deps).not.toHaveBeenCalled();
});
it("the public API request schema describes the same finite labels-only enum", () => {
  expect(openapiSpec.components.schemas.ChatCompletionRequest.properties.language.enum).toEqual([...presentationLanguages]);
  expect(openapiSpec.components.schemas.ChatCompletionRequest.properties.language.description).toContain("does not translate the answer");
});
it.each(locales)("remote MCP %s explicit labels preserve structured bytes and do not pass locale to generation", async language => {
  const run = presentationRun(), runner = vi.fn(async (_input: { question: string; budget?: number }) => run), server = createRemoteMcpServer({ budgetCap: 0.025, clientChannel: "other" }, runner);
  const client = new Client({ name: "offline-presentation", version: "1" }), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.find(tool => tool.name === "research")?.inputSchema.properties?.language).toMatchObject({ enum: [...presentationLanguages] });
    const result = await client.callTool({ name: "research", arguments: { question: run.question, budget: 0, language } });
    expect(result.isError).not.toBe(true); expect(JSON.stringify(result.structuredContent)).toBe(JSON.stringify(remoteResearchResult(run)));
    const content = (result.content as { text: string }[])[0].text;
    expect(content.startsWith(run.answer)).toBe(true); expect(content).toContain(researchPresentationCatalogues[language].citations);
    expect(content).toContain(researchPresentationCatalogues[language].requestedUnknown.replace("{language}", language));
    expect(runner).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ question: run.question, budget: 0 }));
    expect(runner.mock.calls[0][0]).not.toHaveProperty("language"); expect(runner.mock.calls[0][0]).not.toHaveProperty("originalQuestion");
    expect(runner.mock.calls[0][0]).not.toHaveProperty("presentationLanguage");
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { await client.close(); await server.close(); }
});
it("remote MCP rejects unsupported label locale without running research", async () => {
  const runner = vi.fn(async () => presentationRun()), server = createRemoteMcpServer({ budgetCap: 0, clientChannel: "other" }, runner);
  const client = new Client({ name: "offline-refusal", version: "1" }), [a, b] = InMemoryTransport.createLinkedPair();
  try { await server.connect(b); await client.connect(a);
    const response = await client.callTool({ name: "research", arguments: { question: presentationQuestions.en, language: "de" } });
    expect(response.isError).toBe(true); expect(runner).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  } finally { await client.close(); await server.close(); }
});
