import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { QueryRun } from "../types";
import { createRemoteMcpServer } from "./remote-server";
import { mdnModelReplay } from "../agent/fixtures/mdn-model-replay";
import * as privateJobHistoryReader from "../history/private-job-history";
import * as historyDb from "../db";
import type { RemoteMcpAccess } from "./remote-server";
import { PRIVATE_JOB_HISTORY_QUALIFICATION, privateJobHistoryCapabilities } from "../history/private-job-history-contract";
import { PRIVATE_JOB_HISTORY_REFUSAL } from "../history/private-job-history-client";

// New partition fixtures spy only on its established Db/reader bindings. They invoke
// real remote registration via in-memory MCP; no real Db/research/provider is allowed.
describe("remote completed-private-history caller wiring (UNRUN)", () => {
  const actor = `0x${"a".repeat(40)}`, foreign = `0x${"b".repeat(40)}`, id = `prv_${"1".repeat(64)}`;
  const envelope = { format: "private-job-history-v1" as const, wallet: actor, scope: "exact-payer-private-current-store" as const,
    capabilities: privateJobHistoryCapabilities, qualification: PRIVATE_JOB_HISTORY_QUALIFICATION } as const;
  const page = () => ({ ...envelope, rows: [], nextCursor: null, scannedIntents: 0, scanLimited: false });
  const exported = () => ({ ...envelope, rows: [], nextCursor: null, complete: true, truncated: false, pages: 1,
    bounds: { maxPages: 20 as const, maxRows: 500 as const, maxBytes: 2097152 as const } });
  const access = (): RemoteMcpAccess => ({ budgetCap: 0.03, clientChannel: "other", actor, historyScopes: ["history:read"],
    keyId: "original", revalidateHistoryAccess: vi.fn(async () => undefined) });
  async function connect(rights: RemoteMcpAccess) {
    const research = vi.fn(async () => { throw new Error("Forbidden research"); });
    const server = createRemoteMcpServer(rights, research), client = new Client({ name: "private-history", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const sent = vi.spyOn(serverTransport, "send");
    await server.connect(serverTransport); await client.connect(clientTransport);
    return { client, research, sent, close: async () => { await client.close(); await server.close(); } };
  }
  function ports() {
    const getDb = vi.spyOn(historyDb, "getDb").mockResolvedValue({} as Awaited<ReturnType<typeof historyDb.getDb>>);
    const list = vi.spyOn(privateJobHistoryReader, "readPrivateJobHistory").mockResolvedValue(page());
    const detail = vi.spyOn(privateJobHistoryReader, "readPrivateJobHistoryDetail").mockResolvedValue(null);
    const exportHistory = vi.spyOn(privateJobHistoryReader, "exportPrivateJobHistory").mockResolvedValue(exported());
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Forbidden provider/payment IO"));
    return { getDb, list, detail, exportHistory, network,
      restore: () => { getDb.mockRestore(); list.mockRestore(); detail.mockRestore(); exportHistory.mockRestore(); network.mockRestore(); } };
  }
  it("actual registration dispatches list/detail/export to the exact reader under original three fences", async () => {
    const p = ports(), rights = access(), link = await connect(rights);
    try {
      expect((await link.client.callTool({ name: "history_private_jobs_list", arguments: {} })).structuredContent).toEqual(page());
      const absent = await link.client.callTool({ name: "history_private_jobs_detail", arguments: { id } });
      expect(absent).toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] });
      expect((await link.client.callTool({ name: "history_private_jobs_export", arguments: {} })).structuredContent).toEqual(exported());
      expect(p.list).toHaveBeenCalledWith(expect.anything(), actor, { limit: 25 }, expect.objectContaining({ signal: expect.any(AbortSignal), deadline: expect.any(Number) }));
      expect(p.detail).toHaveBeenCalledWith(expect.anything(), actor, id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(p.exportHistory).toHaveBeenCalledWith(expect.anything(), actor, { limit: 25 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(rights.revalidateHistoryAccess).toHaveBeenCalledTimes(9); expect(p.getDb).toHaveBeenCalledTimes(3);
      expect(link.research).not.toHaveBeenCalled(); expect(p.network).not.toHaveBeenCalled();
    } finally { await link.close(); p.restore(); }
  });
  it.each(["actor", "scope", "revalidator", "revoked", "aborted"])("actual remote %s refusal has zero Db/private read/forbidden IO", async missing => {
    const p = ports(), rights = access();
    if (missing === "actor") rights.actor = undefined;
    if (missing === "scope") rights.historyScopes = ["ask"];
    if (missing === "revalidator") rights.revalidateHistoryAccess = undefined;
    if (missing === "revoked") rights.revalidateHistoryAccess = async () => { throw new Error("PRIVATE revoked"); };
    if (missing === "aborted") { const controller = new AbortController(); controller.abort(); rights.signal = controller.signal; }
    const link = await connect(rights);
    try {
      const result = await link.client.callTool({ name: "history_private_jobs_list", arguments: {} });
      expect(result).toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] }); expect(result.structuredContent).toBeUndefined();
      expect(p.getDb).not.toHaveBeenCalled(); expect(p.list).not.toHaveBeenCalled(); expect(p.detail).not.toHaveBeenCalled();
      expect(p.exportHistory).not.toHaveBeenCalled(); expect(link.research).not.toHaveBeenCalled(); expect(p.network).not.toHaveBeenCalled();
    } finally { await link.close(); p.restore(); }
  });
  it("actual remote revocation during Db await refuses before private reader", async () => {
    const p = ports(), rights = access(); let finish!: (db: Awaited<ReturnType<typeof historyDb.getDb>>) => void;
    let started!: () => void; const beginning = new Promise<void>(done => { started = done; }); let revoked = false;
    rights.revalidateHistoryAccess = vi.fn(async () => { if (revoked) throw new Error("PRIVATE revoked"); });
    p.getDb.mockImplementation(async () => { started(); return new Promise(done => { finish = done; }); });
    const link = await connect(rights);
    try {
      const pending = link.client.callTool({ name: "history_private_jobs_list", arguments: {} });
      await beginning; revoked = true; finish({} as Awaited<ReturnType<typeof historyDb.getDb>>);
      const result = await pending; expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
      expect(p.list).not.toHaveBeenCalled(); expect(rights.revalidateHistoryAccess).toHaveBeenCalledTimes(2);
      expect(link.research).not.toHaveBeenCalled(); expect(p.network).not.toHaveBeenCalled();
    } finally { await link.close(); p.restore(); }
  });
  it("actual remote revocation during reader IO suppresses the already computed private output", async () => {
    const p = ports(), rights = access(); let finish!: (value: ReturnType<typeof page>) => void;
    let started!: () => void; const beginning = new Promise<void>(done => { started = done; }); let revoked = false;
    rights.revalidateHistoryAccess = vi.fn(async () => { if (revoked) throw new Error("PRIVATE revoked"); });
    p.list.mockImplementation(async () => { started(); return new Promise(done => { finish = done; }); });
    const link = await connect(rights);
    try {
      const pending = link.client.callTool({ name: "history_private_jobs_list", arguments: {} });
      await beginning; revoked = true; finish(page()); const result = await pending;
      expect(result).toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] }); expect(result.structuredContent).toBeUndefined();
      expect(p.list).toHaveBeenCalledTimes(1); expect(rights.revalidateHistoryAccess).toHaveBeenCalledTimes(3);
      expect(link.research).not.toHaveBeenCalled(); expect(p.network).not.toHaveBeenCalled();
    } finally { await link.close(); p.restore(); }
  });
  it("actual caller rejects internally consistent foreign-owner and extra private fields", async () => {
    const p = ports(), link = await connect(access());
    try {
      p.list.mockResolvedValueOnce({ ...page(), wallet: foreign });
      p.list.mockResolvedValueOnce({ ...page(), privateToken: "SECRET" } as ReturnType<typeof page>);
      for (let n = 0; n < 2; n++) {
        const result = await link.client.callTool({ name: "history_private_jobs_list", arguments: {} });
        expect(result).toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] });
        expect(result.structuredContent).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("SECRET");
      }
      expect(link.research).not.toHaveBeenCalled(); expect(p.network).not.toHaveBeenCalled();
    } finally { await link.close(); p.restore(); }
  });
  it.each(["before-db", "db", "after-db", "after-read"] as const)("SDK cancellation during %s stops the original remote pipeline and suppresses private output", async stage => {
    const p = ports(), rights = access(), http = new AbortController(), call = new AbortController(); rights.signal = http.signal;
    const scopes = rights.historyScopes; let finish!: () => void, started!: () => void, checks = 0;
    const beginning = new Promise<void>(done => { started = done; });
    const pause = () => { started(); return new Promise<void>(done => { finish = done; }); };
    const verifier = vi.fn(async () => {
      checks++;
      if (stage === "before-db" && checks === 1 || stage === "after-db" && checks === 2 || stage === "after-read" && checks === 3) await pause();
    });
    rights.revalidateHistoryAccess = verifier;
    if (stage === "db") p.getDb.mockImplementation(async () => { await pause(); return {} as Awaited<ReturnType<typeof historyDb.getDb>>; });
    const link = await connect(rights);
    try {
      const result = expect(link.client.callTool({ name: "history_private_jobs_list", arguments: {} }, undefined,
        { signal: call.signal })).rejects.toThrow();
      await beginning; call.abort(); await result;
      await new Promise<void>(done => setTimeout(done, 0));
      finish(); await new Promise<void>(done => setTimeout(done, 0));
      expect(p.getDb).toHaveBeenCalledTimes(stage === "before-db" ? 0 : 1);
      expect(p.list).toHaveBeenCalledTimes(stage === "after-read" ? 1 : 0);
      expect(verifier).toHaveBeenCalledTimes(stage === "before-db" || stage === "db" ? 1 : stage === "after-db" ? 2 : 3);
      expect(rights.signal).toBe(http.signal); expect(http.signal.aborted).toBe(false);
      expect(rights.historyScopes).toBe(scopes); expect(rights.keyId).toBe("original"); expect(rights.actor).toBe(actor);
      expect(rights.revalidateHistoryAccess).toBe(verifier);
      expect(JSON.stringify(link.sent.mock.calls)).not.toContain("structuredContent");
      expect(p.detail).not.toHaveBeenCalled(); expect(p.exportHistory).not.toHaveBeenCalled();
      expect(link.research).not.toHaveBeenCalled(); expect(p.network).not.toHaveBeenCalled();
    } finally { await link.close(); p.restore(); }
  });
  it.each(["sdk", "http"] as const)("%s cancellation aborts remote export IO while preserving both signals and original authority", async source => {
    const p = ports(), rights = access(), http = new AbortController(), call = new AbortController(); rights.signal = http.signal;
    const scopes = rights.historyScopes, verifier = rights.revalidateHistoryAccess;
    let started!: () => void, stopped!: () => void, finish!: (value: ReturnType<typeof exported>) => void, signal!: AbortSignal;
    const beginning = new Promise<void>(done => { started = done; }), aborted = new Promise<void>(done => { stopped = done; });
    p.exportHistory.mockImplementation(async (_db, _owner, _input, options) => {
      signal = options!.signal!; signal.addEventListener("abort", stopped, { once: true }); started();
      return new Promise(done => { finish = done; });
    });
    const link = await connect(rights);
    try {
      const pending = link.client.callTool({ name: "history_private_jobs_export", arguments: {} }, undefined, { signal: call.signal });
      const result = source === "sdk" ? expect(pending).rejects.toThrow()
        : expect(pending).resolves.toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] });
      await beginning; (source === "sdk" ? call : http).abort(); await aborted; await result;
      finish(exported()); await new Promise<void>(done => setTimeout(done, 0));
      expect(signal.aborted).toBe(true); expect(rights.signal).toBe(http.signal); expect(rights.historyScopes).toBe(scopes);
      expect(rights.actor).toBe(actor); expect(rights.keyId).toBe("original"); expect(rights.revalidateHistoryAccess).toBe(verifier);
      expect(call.signal.aborted).toBe(source === "sdk"); expect(http.signal.aborted).toBe(source === "http");
      expect(verifier).toHaveBeenCalledTimes(2); expect(p.getDb).toHaveBeenCalledTimes(1); expect(p.exportHistory).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(link.sent.mock.calls)).not.toContain("structuredContent");
      expect(p.list).not.toHaveBeenCalled(); expect(p.detail).not.toHaveBeenCalled();
      expect(link.research).not.toHaveBeenCalled(); expect(p.network).not.toHaveBeenCalled();
    } finally { await link.close(); p.restore(); }
  });
});

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
  it.each([{ reviewFirst: true }, { mode: "review-first" }, { researchMode: "review-first" }, { responseMode: "reviewFirst" }])("refuses unsupported review intent before research: %j", async intent => {
    const runner = vi.fn(async () => completedRun()), server = createRemoteMcpServer({ budgetCap: 0.03, clientChannel: "other" }, runner);
    const client = new Client({ name: "review-refusal-fixture", version: "1" }), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try { await server.connect(serverTransport); await client.connect(clientTransport);
      const result = await client.callTool({ name: "research", arguments: { question: "Synthetic question", ...intent } });
      expect(result.isError).toBe(true); expect(runner).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it("keeps a micro-USDC reward visible in text without changing structured amounts or answer", async () => {
    const run = completedRun();
    run.citations[0].reward = 0.000001;
    run.totalSpent = 0.000001; run.totalToCreators = 0.000001;
    run.paymentMode = "offline"; run.settledPayments = 0;
    const before = JSON.stringify(run);
    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    const server = createRemoteMcpServer({ budgetCap: 0.03, clientChannel: "other" }, async () => run);
    const client = new Client({ name: "exact-money-fixture", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const result = await client.callTool({ name: "research", arguments: { question: run.question } });
      const text = (result.content as { text?: string }[]).map(item => item.text ?? "").join("\n");
      expect(text).toContain("$0.000001 USDC");
      expect(text).toContain("offline payment simulation");
      expect(result.structuredContent).toMatchObject({ answer: run.answer, totalToCreatorsUsdc: 0.000001,
        citations: [{ rewardPlannedUsdc: 0.000001 }], settledPayments: 0 });
      expect(JSON.stringify(run)).toBe(before); expect(http).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); http.mockRestore(); }
  });
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
      expect(client.getServerVersion()?.version).toBe("0.3.18");
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
    expect(tools.tools.map((tool) => tool.name)).toEqual(["evidence_draft", "research_feedback_read", "research_feedback_submit", "draft_check", "evidence_procurement", "deliverable_acceptance_read", "deliverable_acceptance_submit", "operator_obligations_read", "paper_lookup", "research", "keryx_status", "research_monthly", "keryx_operator_status", "keryx_public_job_ledger", "keryx_purchase_outcomes", "keryx_source_learning", "profile_read", "profile_update", "history_read", "history_owned_read", "history_export", "history_private_jobs_list", "history_private_jobs_detail", "history_private_jobs_export", "run_privacy_read", "run_owner_export", "profile_identities_read"]);

    const result = await client.callTool({
      name: "research",
      arguments: { question: "What changed?", budget: 99, scholarly: true, mode: "quick" },
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: 0.03, scholarly: true, researchMode: "quick",
        origin: "mcp",
        asker: "0xAbC",
        provenance: { version: 1, surface: "remote-mcp", ownershipMethod: "api-key" },
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
