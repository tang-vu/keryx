import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import { createRemoteMcpServer } from "./remote-server";
import { mdnModelReplay } from "../agent/fixtures/mdn-model-replay";

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
  it("preserves the retained MDN three-bullet answer and exact evidence through a hermetic SDK client", async () => {
    const replay = mdnModelReplay();
    const run: QueryRun = { ...completedRun(), id: "retained-mdn-local-replay", question: replay.question,
      budget: 0, subClaims: replay.ledger.claimCoverage.map(row => row.claim), answer: replay.answer,
      evidence: replay.ledger.evidence, claimCoverage: replay.ledger.claimCoverage,
      citations: [{ marker: "S1", sourceId: replay.ledger.evidence[0].sourceId, sourceName: "mozilla.org",
        itemId: replay.ledger.evidence[0].itemId, itemUrl: replay.ledger.evidence[0].itemUrl,
        itemTitle: replay.ledger.evidence[0].itemTitle, contentVersion: replay.ledger.evidence[0].contentVersion,
        publicDeliveryKind: "excerpt", webProvenance: replay.ledger.evidence[0].webProvenance,
        sourceKind: "public-reference", weight: 1, reward: 0, rationale: "Retained public evidence, local replay" }],
      totalSpent: 0, totalToCreators: 0, paymentAttempts: 0, settledPayments: 0, reasoningAttempts: [] };
    const runner = vi.fn(async () => run);
    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No external request allowed"));
    const server = createRemoteMcpServer({ budgetCap: 0, clientChannel: "other" }, runner);
    const client = new Client({ name: "retained-mdn-replay-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const result = await client.callTool({ name: "research", arguments: { question: replay.question, budget: 0 } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ answer: replay.answer,
        evidence: replay.ledger.evidence.map(item => ({ claimIndex: item.claimIndex, marker: item.marker,
          sourceId: item.sourceId, itemId: item.itemId, contentVersion: item.contentVersion, quote: item.quote,
          qualifiesForAnswer: true, qualifiesForReward: false })),
        claimCoverage: replay.ledger.claimCoverage, totalToCreatorsUsdc: 0, settledPayments: 0 });
      const retained = JSON.parse(JSON.stringify(result.structuredContent));
      expect(retained.answer.match(/^- /gm)).toHaveLength(3);
      for (const sentence of replay.sentences) expect(retained.answer).toContain(sentence);
      for (const quote of replay.quotes) expect(retained.answer).toContain(`“${quote}”`);
      const text = (result.content as { type: string; text?: string }[]).map(item => item.text ?? "").join("\n");
      expect(text.startsWith(replay.answer)).toBe(true);
      expect(http).not.toHaveBeenCalled();
      expect(runner).toHaveBeenCalledOnce();
    } finally { await client.close(); await server.close(); http.mockRestore(); }
  });
  it("delivers exact retained paper metadata without a research dispatch or external request", async () => {
    const research = vi.fn(async () => completedRun());
    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    const server = createRemoteMcpServer({ budgetCap: 0, clientChannel: "other" }, research);
    const client = new Client({ name: "free-bibliography-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const tools = await client.listTools(); const tool = tools.tools.find(item => item.name === "paper_lookup");
      expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool?.inputSchema.properties?.language).toMatchObject({ enum: ["en", "fr", "vi"] });
      const response = await client.callTool({ name: "paper_lookup", arguments: { query: "2005.11401v4", language: "fr" } });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toMatchObject({ scope: "bibliography-only", totalWorks: 1, providers: [],
        groups: [{ record: { arxivId: "2005.11401v4", authors: ["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus", "Fabio Petroni", "Vladimir Karpukhin", "Naman Goyal", "Heinrich Küttler", "Mike Lewis", "Wen-tau Yih", "Tim Rocktäschel", "Sebastian Riedel", "Douwe Kiela"] } }] });
      expect(response).toMatchObject({ content: [{ type: "text", text: expect.stringContaining("Premier auteur dans la liste complète enregistrée: Patrick Lewis") }] });
      const bibliography = (response.content as Array<{ text: string }>)[0].text;
      for (const value of ["1. Patrick Lewis; 2. Ethan Perez; 3. Aleksandra Piktus", "eprint = {2005.11401v4}", "AN  - arXiv:2005.11401v4", "Référence bibliographique courte", "Provenance des champs"])
        expect(bibliography).toContain(value);
      expect(research).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); http.mockRestore(); }
  });
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
      expect(client.getServerVersion()?.version).toBe("0.3.7");
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
    expect(tools.tools.map((tool) => tool.name)).toEqual(["paper_lookup", "research", "keryx_status", "research_monthly", "keryx_operator_status"]);

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
