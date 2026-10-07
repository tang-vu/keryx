import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ paused: vi.fn(() => true), deps: vi.fn(), run: vi.fn(), quota: vi.fn(), db: vi.fn() }));
vi.mock("../business-operator/canary-policy", () => ({ canaryExecutionPaused: mocks.paused, canaryResearchPaused: mocks.paused }));
vi.mock("../agent", () => ({ getAgentDeps: mocks.deps, collectRun: mocks.run }));
vi.mock("../agent/run-agent", () => ({ runAgent: mocks.run }));
vi.mock("../db", () => ({ getDb: mocks.db }));
vi.mock("../sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.quota }));

import { GET } from "../../app/api/research/availability/route";
import { POST as ask } from "../../app/api/ask/route";
import { POST as openai } from "../../app/api/v1/chat/completions/route";
import { POST as mcp } from "../../app/mcp/route";
import { createRemoteMcpServer } from "../mcp/remote-server";
import { researchFailureMessage } from "../llm/research-plan";
import { buildErrorText as telegram } from "../telegram/ask-message";
import { buildErrorText as slack } from "../slack/ask-command";
import { buildErrorMessage as discord } from "../discord/ask-interaction";
import { parseResearchAvailability, ResearchAdmissionHeldError, RESEARCH_PAUSED_MESSAGE } from "./availability-contract";

function request(path: string, body: unknown) {
  return new NextRequest(`https://keryx.test${path}`, { method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.paused.mockReturnValue(true); });

describe("public research availability", () => {
  it("reads the persistent admission observation without DB initialization or quota consumption", async () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ state: "paused", message: RESEARCH_PAUSED_MESSAGE });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.quota).not.toHaveBeenCalled();
    mocks.paused.mockReturnValue(false);
    expect((await GET().json()).state).toBe("not-paused");
  });
  it.each([null, [], { state: "ready" }, { state: 1 }])("does not infer availability from an invalid observation: %j", value => {
    expect(parseResearchAvailability(value)).toBeNull();
  });
  it("suppresses arbitrary status copy and internal refusal details across hosted error adapters", () => {
    const error = new ResearchAdmissionHeldError("private-journal-path and secret question");
    expect(parseResearchAvailability({ state: "paused", message: error.message })?.message).toBe(RESEARCH_PAUSED_MESSAGE);
    expect(researchFailureMessage(error)).toBe(RESEARCH_PAUSED_MESSAGE);
    for (const output of [telegram(error), slack(error), JSON.stringify(discord(error))]) {
      expect(output).toContain("temporarily paused"); expect(output).not.toContain("private-journal");
    }
    expect(error.message).toContain("private-journal"); // Operations keep their own original diagnostic.
  });
  it("refuses a zero-source-budget browser ask before dependencies, provider, signing or quota work", async () => {
    const response = await ask(request("/api/ask", { question: "Read the original SQLite documentation", budget: 0 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "research_paused", message: RESEARCH_PAUSED_MESSAGE });
    expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.quota).not.toHaveBeenCalled();
  });
  it.each([false, true])("returns an OpenAI-shaped held category before work (stream=%s)", async stream => {
    const response = await openai(request("/api/v1/chat/completions", { stream, budget: 0,
      messages: [{ role: "user", content: "Read original documentation" }] }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "research_paused", message: RESEARCH_PAUSED_MESSAGE } });
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("refuses hosted MCP research before consuming quota while preserving read-only tool discovery", async () => {
    const refused = await mcp(request("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "research", arguments: { question: "Read original documentation", budget: 0 } } }));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { data: { code: "research_paused" }, message: RESEARCH_PAUSED_MESSAGE } });
    const discovered = await mcp(request("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    expect(discovered.status).toBe(200);
    expect((await discovered.json()).result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "paper_lookup", "research", "keryx_status", "research_monthly", "keryx_operator_status",
    ]);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.quota).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("serves retained bibliography during a research hold without research, quota, database or network work", async () => {
    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Retained bibliography must not fetch"));
    try {
      const response = await mcp(request("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "paper_lookup", arguments: { query: "arXiv:2005.11401v4" } } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: { structuredContent: {
        scope: "bibliography-only", totalWorks: 1, providers: [],
        groups: [{ record: { arxivId: "2005.11401v4", authors: expect.arrayContaining(["Patrick Lewis"]) } }],
      } } });
      expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.quota).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
      expect(http).not.toHaveBeenCalled();
    } finally { http.mockRestore(); }
  });
  it("keeps real-SDK MCP connectivity truthful and refuses direct tool calls without invoking research", async () => {
    const runner = vi.fn();
    const server = createRemoteMcpServer({ budgetCap: 0.03, clientChannel: "direct" }, runner);
    const client = new Client({ name: "held-fixture", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st); await client.connect(ct);
      const status = await client.callTool({ name: "keryx_status", arguments: {} });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({ endpoint: "connected", researchAvailability: { state: "paused" } });
      expect(JSON.stringify(status)).not.toContain("is ready");
      const result = await client.callTool({ name: "research", arguments: { question: "Read original documentation", budget: 0 } });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: "research_paused", message: RESEARCH_PAUSED_MESSAGE });
      expect(runner).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
});
