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
  it("reports the actual heuristic decide tier over MCP while preserving the original model label", async () => {
    const run = completedRun(); run.engine = "llm:deepseek:recorded-model";
    run.reasoningAttempts = [
      { step: "decompose", engine: run.engine, tier: 0, attempt: 1, startedAt: 1, durationMs: 5, outcome: "served" },
      { step: "decide", engine: run.engine, tier: 0, attempt: 0, startedAt: 2, durationMs: 0, outcome: "circuit-open", retryAfterMs: 1000 },
      { step: "decide", engine: "heuristic", tier: 1, attempt: 1, startedAt: 3, durationMs: 1, outcome: "served" },
      { step: "synthesize", engine: run.engine, tier: 0, attempt: 1, startedAt: 4, durationMs: 1,
        outcome: "failed", error: "output_validation", outputTokenLimit: 2560 },
    ];
    const server = createRemoteMcpServer({ budgetCap: 0.03, clientChannel: "codex" }, async () => run);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      expect(client.getServerVersion()?.version).toBe("0.3.4");
      const result = await client.callTool({ name: "research", arguments: { question: "What changed?" } });
      expect(result.structuredContent).toMatchObject({ engine: run.engine, reasoningAttempts: run.reasoningAttempts,
        reasoning: { sourceSelection: { state: "heuristic", servingEngines: ["heuristic"], fallbackUsed: true } } });
      const text = (result.content as { type: string; text?: string }[]).map(item => item.text ?? "").join("\n");
      expect(text).toContain("Recorded source selection: heuristic · heuristic · fallback served");
      expect(text).toContain("does not verify entailment or complete synthesis");
      expect(text).toContain("Model output limit reached: answer preparation (2,560 tokens)");
    } finally { await client.close(); await server.close(); }
  });

  it.each([undefined, "offline"] as const)("labels %s payment history without inferring simulation from missing mode", async paymentMode => {
    const run = completedRun(); run.paymentMode = paymentMode; run.reasoningAttempts = undefined;
    const server = createRemoteMcpServer({ budgetCap: 0.03, clientChannel: "other" }, async () => run);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const result = await client.callTool({ name: "research", arguments: { question: "What changed?" } });
      const text = (result.content as { type: string; text?: string }[]).map(item => item.text ?? "").join("\n");
      expect(result.structuredContent).toMatchObject({ paymentMode: paymentMode ?? "legacy",
        reasoning: { sourceSelection: { state: "unknown", fallbackUsed: null } } });
      if (paymentMode === "offline") expect(text).toContain("offline payment simulation");
      else { expect(text).toContain("payment mode unknown"); expect(text).not.toContain("offline payment simulation"); }
      expect(text).toContain("Recorded source selection: unknown");
    } finally { await client.close(); await server.close(); }
  });

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
    expect(tools.tools.map((tool) => tool.name)).toEqual(["research", "keryx_status", "research_monthly", "keryx_operator_status"]);

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
    expect(responseText).toContain("decide: heuristic (heuristic; fallback served)");
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        queryId: "mcp-run",
        totalToCreatorsUsdc: 0.01,
        settledPayments: 1,
        reasoningAttempts: expect.arrayContaining([expect.objectContaining({ step: "decide", engine: "heuristic", outcome: "served" })]),
        reasoning: expect.objectContaining({ telemetry: "recorded",
          sourceSelection: { step: "decide", state: "heuristic", servingEngines: ["heuristic"], fallbackUsed: true } }),
      }),
    );

    runner.mockClear();
    const free = await client.callTool({ name: "research", arguments: { question: "Read free originals", budget: 0 } });
    expect(free.isError).not.toBe(true);
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ budget: 0 }));

    await client.close();
    await server.close();
  });
});
