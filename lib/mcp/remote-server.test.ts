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
  };
}

describe("remote MCP server", () => {
  it("exposes research and clamps budget while preserving verified attribution", async () => {
    const runner = vi.fn(async () => completedRun());
    const server = createRemoteMcpServer(
      { budgetCap: 0.03, actor: "0xAbC" },
      runner,
    );
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["research", "keryx_status"]);

    const result = await client.callTool({
      name: "research",
      arguments: { question: "What changed?", budget: 99 },
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: 0.03,
        origin: "mcp",
        asker: "0xAbC",
      }),
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        queryId: "mcp-run",
        totalToCreatorsUsdc: 0.01,
        settledPayments: 1,
      }),
    );

    await client.close();
    await server.close();
  });
});
