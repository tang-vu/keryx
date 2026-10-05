import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import { createRemoteMcpServer } from "./remote-server";

function completedRun(): QueryRun {
  return {
    id: "mcp-run",
    question: "What changed?",
    budget: 0.03,
    engine: "heuristic",
    subClaims: [],
    decisions: [],
    citations: [
      {
        marker: "S1",
        sourceId: "source-1",
        sourceName: "Creator One",
        weight: 1,
        reward: 0.01,
        rationale: "Primary evidence.",
      },
    ],
    answer: "A grounded answer [S1].",
    totalSpent: 0.01,
    totalToCreators: 0.01,
    trace: [],
    createdAt: "2026-07-27T00:00:00.000Z",
    origin: "mcp",
    asker: "0xabc",
    confidence: { level: "High", reason: "covered" },
    paymentMode: "real",
    paymentAttempts: 1,
    settledPayments: 1,
    reasoningAttempts: [
      { step: "decompose", engine: "llm:deepseek:deepseek-v4-flash", tier: 0, attempt: 1, startedAt: 1, durationMs: 1, outcome: "served" },
      { step: "decide", engine: "llm:deepseek:deepseek-v4-flash", tier: 0, attempt: 0, startedAt: 2, durationMs: 0, outcome: "circuit-open" },
      { step: "decide", engine: "heuristic", tier: 3, attempt: 1, startedAt: 3, durationMs: 0, outcome: "served" },
    ],
  };
}

describe("remote MCP server", () => {
  it("exposes research and clamps budget while preserving verified attribution", async () => {
    const runner = vi.fn(async () => completedRun());
    const server = createRemoteMcpServer(
      { budgetCap: 0.03, actor: "0xAbC", clientChannel: "codex" },
      runner,
    );
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["research", "keryx_status", "research_monthly"]);

    const result = await client.callTool({
      name: "research",
      arguments: { question: "What changed?", budget: 99, scholarly: true, mode: "quick" },
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: 0.03, scholarly: true, researchMode: "quick",
        origin: "mcp",
        asker: "0xAbC",
        mcpClient: "codex",
      }),
    );
    expect(result.isError).not.toBe(true);
    const responseText = (result.content as { type: string; text?: string }[]).filter(item => item.type === "text").map(item => item.text).join("\n");
    expect(responseText).toContain("research targets meet the recorded excerpt-support threshold");
    expect(responseText).toContain("does not verify entailment or complete synthesis");
    expect(responseText).not.toContain("claims passed the grounding threshold");
    expect(responseText).toContain("decide: heuristic (degraded)");
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        queryId: "mcp-run",
        totalToCreatorsUsdc: 0.01,
        settledPayments: 1,
        reasoningTelemetry: "recorded",
        reasoningAttempts: expect.arrayContaining([expect.objectContaining({ step: "decide", engine: "heuristic", outcome: "served" })]),
        reasoningServing: expect.arrayContaining([expect.objectContaining({ step: "decide", engines: ["heuristic"], degraded: true, heuristic: true })]),
      }),
    );

    await client.close();
    await server.close();
  });
});
