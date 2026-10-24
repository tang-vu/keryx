import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrivateJobHistoryRead, registerPrivateJobHistoryTools, type PrivateJobHistoryAccess,
  type PrivateJobHistoryTools } from "./private-job-history-mcp";
import { createPrivateJobHistoryClient, PRIVATE_JOB_HISTORY_REFUSAL } from "./private-job-history-client";
import { PRIVATE_JOB_HISTORY_BOUNDS as B, PRIVATE_JOB_HISTORY_QUALIFICATION, privateJobHistoryCapabilities,
  privateJobHistoryInputSchema, privateJobHistoryDetailInputSchema,
  type PrivateJobHistoryPage, type PrivateJobHistoryDetail, type PrivateJobHistoryExport } from "./private-job-history-contract";

const wallet = `0x${"a".repeat(40)}`, foreign = `0x${"b".repeat(40)}`, token = `kx_live_${"1".repeat(96)}`;
const id = `prv_${"1".repeat(64)}`, date = "2026-10-14T00:00:00.123456+00:00";
const envelope = { format: "private-job-history-v1" as const, wallet, scope: "exact-payer-private-current-store" as const,
  capabilities: privateJobHistoryCapabilities, qualification: PRIVATE_JOB_HISTORY_QUALIFICATION } as const;
const page = (): PrivateJobHistoryPage => ({ ...envelope, rows: [], nextCursor: null, scannedIntents: 0, scanLimited: false });
const exported = (): PrivateJobHistoryExport => ({ ...envelope, rows: [], nextCursor: null, complete: true, truncated: false,
  pages: 1, bounds: { maxPages: 20, maxRows: 500, maxBytes: 2097152 } });
const detail = (): PrivateJobHistoryDetail => ({ ...envelope, row: { id, ownerWallet: wallet, createdAt: date,
  intentCreatedAt: null, savedAt: date, question: "PRIVATE question", researchMode: "deep", model: null,
  packageVersion: "1.0.0", record: "finalized-private-result", provenance: null,
  incomingSettlement: { status: "settled", amountMicros: "120000", network: "eip155:5042", reference: "incoming",
    settledAt: date, evidenceSource: "circle-facilitator-success", chainFinalityVerified: false },
  ownSettledSpendMicros: null, creatorRewardsMicros: null, paidCreators: null }, result: { answer: "PRIVATE saved answer",
  engine: "saved", createdAt: date, savedAt: date, subClaims: [], decisions: [], citations: [], evidence: null,
  claimCoverage: null, paymentEvidence: "incoming-only-no-creator-ledger" } });
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve }; }
function authority(): PrivateJobHistoryAccess { return { actor: wallet, historyScopes: ["history:read"], keyId: "original",
  revalidateHistoryAccess: vi.fn(async () => undefined) }; }
afterEach(() => vi.useRealTimers());

describe("new remote private-read admission (UNRUN synthetic authority)", () => {
  it.each([{}, { actor: wallet }, { actor: wallet, historyScopes: ["ask"] }, { actor: wallet, historyScopes: ["history:read"] },
    { historyScopes: ["history:read"], revalidateHistoryAccess: async () => undefined }])("requires verified actor/scope/original revalidator before Db: %j", async access => {
    const getDb = vi.fn(async () => ({})), read = vi.fn(async () => "PRIVATE");
    await expect(createPrivateJobHistoryRead(access, getDb).read(read)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(getDb).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it("orders original revalidation before Db, after Db and after private read", async () => {
    const events: string[] = [], access = authority(), db = {};
    access.revalidateHistoryAccess = vi.fn(async () => { events.push("revalidate"); });
    const getDb = vi.fn(async () => { events.push("db"); return db; });
    const read = vi.fn(async (store: object, owner: string, options: { signal: AbortSignal; deadline: number }) => {
      events.push("private-read"); expect(store).toBe(db); expect(owner).toBe(wallet);
      expect(options.signal.aborted).toBe(false); expect(options.deadline).toBeLessThanOrEqual(Date.now() + B.readMs); return "PRIVATE";
    });
    expect(await createPrivateJobHistoryRead(access, getDb).read(read)).toBe("PRIVATE");
    expect(events).toEqual(["revalidate", "db", "revalidate", "private-read", "revalidate"]);
  });
  it("expired/revoked initial access refuses before Db and private IO", async () => {
    const access = authority(); access.revalidateHistoryAccess = vi.fn(async () => { throw new Error(`PRIVATE ${token}`); });
    const getDb = vi.fn(async () => ({})), read = vi.fn(async () => "PRIVATE");
    await expect(createPrivateJobHistoryRead(access, getDb).read(read)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(getDb).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it("revocation during Db await refuses before the first private read", async () => {
    const access = authority(), pending = deferred<object>(), started = deferred<void>(); let revoked = false;
    access.revalidateHistoryAccess = vi.fn(async () => { if (revoked) throw new Error("revoked"); });
    const getDb = vi.fn(async () => { started.resolve(); return pending.promise; }), read = vi.fn(async () => "PRIVATE");
    const result = expect(createPrivateJobHistoryRead(access, getDb).read(read)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await started.promise; revoked = true; pending.resolve({}); await result;
    expect(access.revalidateHistoryAccess).toHaveBeenCalledTimes(2); expect(read).not.toHaveBeenCalled();
  });
  it.each(["actor", "scopes", "scope-content", "verifier", "keyId", "signal"])("replacement %s during Db await cannot substitute authority", async field => {
    const access = authority(), original = access.revalidateHistoryAccess!, replacement = vi.fn(async () => undefined);
    const pending = deferred<object>(), started = deferred<void>(), read = vi.fn(async () => "PRIVATE");
    const getDb = vi.fn(async () => { started.resolve(); return pending.promise; });
    const result = expect(createPrivateJobHistoryRead(access, getDb).read(read)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await started.promise;
    if (field === "actor") access.actor = foreign;
    if (field === "scopes") access.historyScopes = ["history:read"];
    if (field === "scope-content") (access.historyScopes as string[])[0] = "ask";
    if (field === "verifier") access.revalidateHistoryAccess = replacement;
    if (field === "keyId") access.keyId = "replacement";
    if (field === "signal") access.signal = new AbortController().signal;
    pending.resolve({}); await result;
    expect(original).toHaveBeenCalledTimes(1); expect(replacement).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it("revocation during private read suppresses stale output with no retry", async () => {
    const access = authority(), pending = deferred<string>(), started = deferred<void>(); let revoked = false;
    access.revalidateHistoryAccess = vi.fn(async () => { if (revoked) throw new Error("revoked"); });
    const read = vi.fn(async () => { started.resolve(); return pending.promise; });
    const result = expect(createPrivateJobHistoryRead(access, async () => ({})).read(read)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await started.promise; revoked = true; pending.resolve("PRIVATE"); await result;
    expect(access.revalidateHistoryAccess).toHaveBeenCalledTimes(3); expect(read).toHaveBeenCalledTimes(1);
  });
  it("aborted/expired ignored Db await ends finitely with zero private read", async () => {
    vi.useFakeTimers(); const access = authority(), getDb = vi.fn(() => new Promise<object>(() => undefined)), read = vi.fn(async () => "PRIVATE");
    const result = expect(createPrivateJobHistoryRead(access, getDb).read(read)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    await vi.advanceTimersByTimeAsync(B.readMs); await result; expect(read).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(); access.signal = controller.signal;
    getDb.mockClear();
    await expect(createPrivateJobHistoryRead(access, getDb).read(read)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(getDb).not.toHaveBeenCalled();
  });
  it("pre-aborted call signal refuses before original verification or Db acquisition", async () => {
    const access = authority(), controller = new AbortController(); controller.abort();
    const getDb = vi.fn(async () => ({})), read = vi.fn(async () => "PRIVATE");
    await expect(createPrivateJobHistoryRead(access, getDb).read(read, false, controller.signal)).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    expect(access.revalidateHistoryAccess).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it("capture cannot be repaired with a new revalidator and final synchronous access loss refuses", async () => {
    const access = authority(), helper = createPrivateJobHistoryRead(access, async () => ({}));
    await helper.read(async () => page()); access.actor = foreign;
    expect(() => helper.current()).toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
    const missing: PrivateJobHistoryAccess = { actor: wallet, historyScopes: ["history:read"] };
    const absent = createPrivateJobHistoryRead(missing, vi.fn(async () => ({})));
    missing.revalidateHistoryAccess = async () => undefined;
    await expect(absent.read(async () => page())).rejects.toThrow(PRIVATE_JOB_HISTORY_REFUSAL);
  });
});

async function connection(tools: PrivateJobHistoryTools) {
  const server = new McpServer({ name: "private-history-fixture", version: "1" }); registerPrivateJobHistoryTools(server, tools);
  const client = new Client({ name: "private-caller", version: "1" }), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sent = vi.spyOn(serverTransport, "send");
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, clientTransport, sent, close: async () => { await client.close(); await server.close(); } };
}
describe("shared MCP registration and stdio key bridge (UNRUN)", () => {
  it("discovers exactly three read-only finite tools; valid outputs use the shared contract", async () => {
    const tools = { list: vi.fn(async () => page()), detail: vi.fn(async (): Promise<PrivateJobHistoryDetail | null> => detail()), export: vi.fn(async () => exported()) };
    const link = await connection(tools);
    try {
      const discovered = await link.client.listTools();
      expect(discovered.tools.map(tool => tool.name)).toEqual(["history_private_jobs_list", "history_private_jobs_detail", "history_private_jobs_export"]);
      for (const tool of discovered.tools) {
        expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
        expect(tool.outputSchema).toBeDefined(); expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      }
      expect(discovered.tools[0].inputSchema).toEqual(z.toJSONSchema(privateJobHistoryInputSchema, { target: "draft-7", io: "input" }));
      expect(discovered.tools[1].inputSchema).toEqual(z.toJSONSchema(privateJobHistoryDetailInputSchema, { target: "draft-7", io: "input" }));
      expect(discovered.tools[1].inputSchema.required).toEqual(["id"]);
      const list = await link.client.callTool({ name: "history_private_jobs_list", arguments: {} });
      expect(list.structuredContent).toEqual(page()); expect(tools.list).toHaveBeenCalledWith({ limit: 25 }, { signal: expect.any(AbortSignal) });
      const exportedResult = await link.client.callTool({ name: "history_private_jobs_export", arguments: {} });
      expect(exportedResult.structuredContent).toEqual(exported());
      const saved = await link.client.callTool({ name: "history_private_jobs_detail", arguments: { id } });
      expect(saved.structuredContent).toEqual(detail()); expect(tools.detail).toHaveBeenCalledWith({ id }, { signal: expect.any(AbortSignal) });
      tools.detail.mockResolvedValueOnce(null);
      const absent = await link.client.callTool({ name: "history_private_jobs_detail", arguments: { id } });
      expect(absent).toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] }); expect(absent.structuredContent).toBeUndefined();
    } finally { await link.close(); }
  });
  it("unknown owner selectors and invalid detail IDs refuse before callbacks", async () => {
    const tools = { list: vi.fn(async () => page()), detail: vi.fn(async () => null), export: vi.fn(async () => exported()) };
    const link = await connection(tools);
    try {
      for (const [name, args] of [["history_private_jobs_list", { wallet }], ["history_private_jobs_export", { format: "csv" }],
        ["history_private_jobs_detail", { id: "public-id" }]] as const) {
        expect((await link.client.callTool({ name, arguments: args })).isError).toBe(true);
      }
      expect(tools.list).not.toHaveBeenCalled(); expect(tools.detail).not.toHaveBeenCalled(); expect(tools.export).not.toHaveBeenCalled();
    } finally { await link.close(); }
  });
  it("SDK validation errors cannot echo tokens, cursors or unknown private field names", async () => {
    const tools = { list: vi.fn(async () => page()), detail: vi.fn(async () => null), export: vi.fn(async () => exported()) };
    const link = await connection(tools);
    try {
      for (const argumentsValue of [{ cursor: `${token}/private` }, { surface: token }, { [token]: "private" }, { from: token }]) {
        const result = await link.client.callTool({ name: "history_private_jobs_list", arguments: argumentsValue });
        expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain(token);
        expect(JSON.stringify(result)).not.toContain("/private"); expect(result.structuredContent).toBeUndefined();
      }
      expect(tools.list).not.toHaveBeenCalled();
    } finally { await link.close(); }
  });
  it.each(["malformed", "foreign-row", "oversized", "false-truncation"])("suppresses %s output instead of echoing private diagnostics", async kind => {
    const raw: unknown = kind === "malformed" ? { secret: token, answer: "PRIVATE" }
      : kind === "foreign-row" ? { ...page(), wallet: foreign, rows: [{ ownerWallet: wallet }] }
      : kind === "oversized" ? { ...page(), rows: Array(26).fill({ question: "PRIVATE" }) }
      : { ...exported(), complete: true, truncated: true };
    const tools = { list: async () => raw as PrivateJobHistoryPage, detail: async () => null,
      export: async () => raw as PrivateJobHistoryExport };
    const link = await connection(tools);
    try {
      const result = await link.client.callTool({ name: kind === "false-truncation" ? "history_private_jobs_export" : "history_private_jobs_list", arguments: {} });
      expect(result).toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] }); expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(result)).not.toContain("PRIVATE");
    } finally { await link.close(); }
  });
  it("stdio uses the same HTTPS client/key role and cannot inherit payer wallet or chat label", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(page()));
    const client = createPrivateJobHistoryClient("https://example.test", () => token, fetcher), link = await connection(client);
    try {
      expect((await link.client.callTool({ name: "history_private_jobs_list", arguments: {} })).structuredContent).toEqual(page());
      expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
      const emptyKey = createPrivateJobHistoryClient("https://example.test", () => undefined, fetcher), absent = await connection(emptyKey);
      try {
        expect((await absent.client.callTool({ name: "history_private_jobs_list", arguments: {} })).isError).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally { await absent.close(); }
    } finally { await link.close(); }
  });
  it("final lifetime fence suppresses a completed callback before structured output", async () => {
    const tools = { list: async () => page(), detail: async () => null, export: async () => exported(),
      current: () => { throw new Error(`PRIVATE ${token}`); } }, link = await connection(tools);
    try {
      const result = await link.client.callTool({ name: "history_private_jobs_list", arguments: {} });
      expect(result).toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] }); expect(result.structuredContent).toBeUndefined();
    } finally { await link.close(); }
  });
  it.each(["list", "detail", "export"] as const)("SDK %s cancellation queued before validation dispatch has zero private HTTPS IO", async operation => {
    const fetcher = vi.fn<typeof fetch>(), key = vi.fn(() => token);
    const client = createPrivateJobHistoryClient("https://example.test", key, fetcher), current = vi.spyOn(client, "current");
    const link = await connection(client);
    try {
      // Deliver both messages synchronously, before the SDK's validation/handler microtasks.
      const dispatch = link.clientTransport.send({ jsonrpc: "2.0", id: 700,
        method: "tools/call", params: { name: `history_private_jobs_${operation}`, arguments: operation === "detail" ? { id } : {} } });
      const cancel = link.clientTransport.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 700 } });
      await Promise.all([dispatch, cancel]);
      await new Promise<void>(done => setTimeout(done, 0));
      expect(fetcher).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(current).not.toHaveBeenCalled();
      expect(link.sent.mock.calls.some(([message]) => "id" in message && message.id === 700)).toBe(false);
    } finally { await link.close(); }
  });
  it.each(["list", "detail", "export"] as const)("SDK %s cancellation aborts pending HTTPS and cancels a late private body without retry/output", async operation => {
    const transport = deferred<Response>(), started = deferred<void>(), aborted = deferred<void>(), bodyCancelled = deferred<void>();
    let signal!: AbortSignal;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init!.signal as AbortSignal; signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      started.resolve(); return transport.promise;
    });
    const client = createPrivateJobHistoryClient("https://example.test", () => token, fetcher), current = vi.spyOn(client, "current");
    const link = await connection(client), controller = new AbortController();
    try {
      const result = expect(link.client.callTool({ name: `history_private_jobs_${operation}`, arguments: operation === "detail" ? { id } : {} },
        undefined, { signal: controller.signal })).rejects.toThrow();
      await started.promise; controller.abort(); await aborted.promise; await result;
      transport.resolve(new Response(new ReadableStream({ cancel() { bodyCancelled.resolve(); } }), { headers: { "content-type": "application/json" } }));
      await bodyCancelled.promise; await new Promise<void>(done => setTimeout(done, 0));
      expect(signal.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1); expect(current).not.toHaveBeenCalled();
      expect(JSON.stringify(link.sent.mock.calls)).not.toContain("structuredContent");
      expect(JSON.stringify(link.sent.mock.calls)).not.toContain(token);
    } finally { await link.close(); }
  });
  it.each(["list", "detail", "export"] as const)("SDK %s cancellation during response-body reading aborts/cancels the stream and suppresses private output", async operation => {
    const reading = deferred<void>(), cancelled = deferred<void>(); let signal!: AbortSignal;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init!.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"private":"PRIVATE')); },
        pull() { reading.resolve(); return new Promise<void>(() => undefined); },
        cancel() { cancelled.resolve(); },
      }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } });
    });
    const client = createPrivateJobHistoryClient("https://example.test", () => token, fetcher), current = vi.spyOn(client, "current");
    const link = await connection(client), controller = new AbortController();
    try {
      const result = expect(link.client.callTool({ name: `history_private_jobs_${operation}`, arguments: operation === "detail" ? { id } : {} },
        undefined, { signal: controller.signal })).rejects.toThrow();
      await reading.promise; controller.abort(); await result; await cancelled.promise;
      await new Promise<void>(done => setTimeout(done, 0));
      expect(signal.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1); expect(current).not.toHaveBeenCalled();
      expect(JSON.stringify(link.sent.mock.calls)).not.toContain("structuredContent");
      expect(JSON.stringify(link.sent.mock.calls)).not.toContain("PRIVATE");
    } finally { await link.close(); }
  });
  it("SDK suppresses the final export reply when the caller cancels at the synchronous lifetime fence", async () => {
    const controller = new AbortController(), tools = { list: async () => page(), detail: async () => detail(), export: async () => exported(),
      current: vi.fn(() => controller.abort()) }, link = await connection(tools);
    try {
      await expect(link.client.callTool({ name: "history_private_jobs_export", arguments: {} }, undefined,
        { signal: controller.signal })).rejects.toThrow();
      await new Promise<void>(done => setTimeout(done, 0));
      expect(tools.current).toHaveBeenCalledTimes(1); expect(JSON.stringify(link.sent.mock.calls)).not.toContain("structuredContent");
    } finally { await link.close(); }
  });
  it("SDK connection close aborts a pending export HTTPS request and cancels its late body", async () => {
    const transport = deferred<Response>(), started = deferred<void>(), aborted = deferred<void>(), cancelled = deferred<void>();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      init!.signal!.addEventListener("abort", () => aborted.resolve(), { once: true }); started.resolve(); return transport.promise;
    });
    const client = createPrivateJobHistoryClient("https://example.test", () => token, fetcher), current = vi.spyOn(client, "current");
    const link = await connection(client);
    try {
      const result = expect(link.client.callTool({ name: "history_private_jobs_export", arguments: {} })).rejects.toThrow();
      await started.promise; await link.client.close(); await aborted.promise; await result;
      transport.resolve(new Response(new ReadableStream({ cancel() { cancelled.resolve(); } }), { headers: { "content-type": "application/json" } }));
      await cancelled.promise; await new Promise<void>(done => setTimeout(done, 0));
      expect(fetcher).toHaveBeenCalledTimes(1); expect(current).not.toHaveBeenCalled();
      expect(JSON.stringify(link.sent.mock.calls)).not.toContain("structuredContent");
    } finally { await link.close(); }
  });
  it.each(["key", "owner"] as const)("forwarded SDK signal preserves the existing %s lifetime refusal", async replacement => {
    let key = token;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(page()))
      .mockResolvedValueOnce(Response.json({ ...page(), wallet: foreign }));
    const link = await connection(createPrivateJobHistoryClient("https://example.test", () => key, fetcher));
    try {
      expect((await link.client.callTool({ name: "history_private_jobs_list", arguments: {} })).structuredContent).toEqual(page());
      if (replacement === "key") key = `kx_live_${"2".repeat(96)}`;
      const result = await link.client.callTool({ name: "history_private_jobs_list", arguments: {} });
      expect(result).toMatchObject({ isError: true, content: [{ text: PRIVATE_JOB_HISTORY_REFUSAL }] });
      expect(result.structuredContent).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(replacement === "key" ? 1 : 2);
    } finally { await link.close(); }
  });
});
