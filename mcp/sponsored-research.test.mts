import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MAX_ASK_QUESTION_CHARS } from "../lib/ask-input.ts";
import { researchSponsored, SponsoredResearchError, type SponsoredResearchResult } from "../shared/sponsored-research-client.ts";
import { registerSponsoredResearchTool, type SponsoredResearchToolOptions } from "./sponsored-research.mts";

const baseUrl = "https://sponsored.example";
const queryId = "12345678-1234-4234-8234-123456789abc";
const input = { question: "Public fixture question", publicReport: true as const };
const completed = (): SponsoredResearchResult => ({
  answer: "Fixture answer [S1]", queryId, dispatchUrl: `${baseUrl}/dispatch/${queryId}`,
  citations: [{ sourceName: "Fixture source", sourceUrl: "https://source.example/paper" }],
});
function hostedResponse() {
  const chunk = (delta: object, terminal = false) => ({
    id: `chatcmpl-${queryId}`, object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: terminal ? "stop" : null }],
    ...(terminal ? { keryx: { ...completed(), answer: undefined, totalToCreators: 0,
      paymentMode: "pending", claimTicket: "PRIVATE fixture" },
    keryx_private: { claimTicket: "PRIVATE fixture" } } : {}),
  });
  return new Response([
    `data: ${JSON.stringify(chunk({ content: completed().answer }))}\n\n`,
    `data: ${JSON.stringify(chunk({}, true))}\n\n`, "data: [DONE]\n\n",
  ].join(""), { headers: { "Content-Type": "text/event-stream" } });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function connection(options: SponsoredResearchToolOptions) {
  const server = new McpServer({ name: "sponsored-fixture", version: "1" });
  registerSponsoredResearchTool(server, options);
  return connect(server);
}
async function connect(server: McpServer) {
  const client = new Client({ name: "sponsored-caller", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("sponsored MCP registration", () => {
  it("discovers explicit public consent, bounded inputs and nonidempotent/open-world behavior", async () => {
    const executor = vi.fn(async () => completed()), link = await connection({ baseUrl, executor });
    try {
      const { tools } = await link.client.listTools();
      expect(tools.map(t => t.name)).toEqual(["ask_keryx_sponsored"]);
      const tool = tools[0];
      expect(tool.title).toContain("sponsored"); expect(tool.description).toContain("paid buyer");
      expect(tool.inputSchema.required).toEqual(["question", "publicReport"]);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.properties).toMatchObject({
        question: { maxLength: MAX_ASK_QUESTION_CHARS }, publicReport: { const: true },
        mode: { enum: ["quick", "deep"] }, budget: { minimum: 0, maximum: 0.08 },
      });
      expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
      expect(executor).not.toHaveBeenCalled();
    } finally { await link.close(); }
  });

  it.each([
    { question: input.question }, { ...input, publicReport: false }, { ...input, publicReport: "true" },
    { ...input, question: " \n " }, { ...input, question: "x".repeat(MAX_ASK_QUESTION_CHARS + 1) },
    { ...input, mode: "automatic" }, { ...input, budget: -0.000001 }, { ...input, budget: 0.080001 },
    { ...input, budget: "0" }, { ...input, privateTask: "PRIVATE fixture" },
    { ...input, apiKey: "PRIVATE fixture" }, { ...input, wallet: "PRIVATE fixture" },
  ])("refuses invalid or private input before execution: %j", async args => {
    const executor = vi.fn(async () => completed()), link = await connection({ baseUrl, executor });
    try {
      const result = await link.client.callTool({ name: "ask_keryx_sponsored", arguments: args });
      expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
      expect(executor).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("PRIVATE fixture");
      expect(JSON.stringify(result)).not.toContain("automatic");
    } finally { await link.close(); }
  });

  it.each([
    { ...input, question: "  x  ", mode: "quick" as const, budget: 0 },
    { ...input, mode: "deep" as const, budget: 0.08 }, input,
  ])("invokes the injected shared executor exactly once, including zero: %j", async args => {
    const executor = vi.fn(async () => completed()), link = await connection({ baseUrl, executor });
    try {
      const result = await link.client.callTool({ name: "ask_keryx_sponsored", arguments: args });
      expect(result.isError).not.toBe(true); expect(result.structuredContent).toEqual(completed());
      expect(executor).toHaveBeenCalledExactlyOnceWith({ ...args, question: args.question.trim() },
        { baseUrl, signal: expect.any(AbortSignal) });
    } finally { await link.close(); }
  });

  it("sanitizes an uncertain executor failure and never retries or falls back", async () => {
    const executor = vi.fn(async () => { throw new Error("PRIVATE fixture kx_live_secret backend wallet path"); });
    const link = await connection({ baseUrl, executor });
    try {
      const result = await link.client.callTool({ name: "ask_keryx_sponsored", arguments: input });
      expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
      const text = JSON.stringify(result);
      expect(text).toContain("uncertain"); expect(text).toContain("Do not retry automatically");
      expect(text).toContain("No paid fallback"); expect(text).not.toContain("PRIVATE fixture");
      expect(text).not.toContain("kx_live_secret"); expect(executor).toHaveBeenCalledOnce();
    } finally { await link.close(); }
  });

  it.each([429, 503])("uses the shared client's HTTP %i refusal without exposing the backend body", async status => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { message: "PRIVATE fixture", code: "PRIVATE fixture" }, retryAfter: 60 },
      { status, headers: { "Retry-After": "60" } }));
    const executor: typeof researchSponsored = (args, options) => researchSponsored(args, { ...options, fetch: fetcher });
    const link = await connection({ baseUrl, executor });
    try {
      const result = await link.client.callTool({ name: "ask_keryx_sponsored", arguments: input });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain("PRIVATE fixture");
      expect(JSON.stringify(result)).toContain("Wait at least 60 seconds"); expect(fetcher).toHaveBeenCalledOnce();
    } finally { await link.close(); }
  });

  it("an incomplete stream keeps the original public query/report identity without claiming an answer or retrying", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(`data: ${JSON.stringify({
      id: `chatcmpl-${queryId}`, choices: [{ delta: { content: "Unfinished fixture answer" }, finish_reason: null }],
    })}\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
    const executor: typeof researchSponsored = (args, options) => researchSponsored(args, { ...options, fetch: fetcher });
    const link = await connection({ baseUrl, executor });
    try {
      const result = await link.client.callTool({ name: "ask_keryx_sponsored", arguments: input });
      expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).toContain(queryId); expect(JSON.stringify(result)).toContain(`${baseUrl}/dispatch/${queryId}`);
      expect(JSON.stringify(result)).toContain("uncertain"); expect(JSON.stringify(result)).not.toContain("Unfinished fixture answer");
      expect(fetcher).toHaveBeenCalledOnce();
    } finally { await link.close(); }
  });

  it("does not echo typed error messages, codes, malformed retry headers or foreign report URLs", async () => {
    const executor = vi.fn(async () => { throw new SponsoredResearchError("PRIVATE fixture", {
      code: "PRIVATE fixture", status: 429, retryAfter: "PRIVATE fixture", queryId,
      dispatchUrl: `https://foreign.example/dispatch/${queryId}`, uncertain: false,
    }); });
    const link = await connection({ baseUrl, executor });
    try {
      const result = await link.client.callTool({ name: "ask_keryx_sponsored", arguments: input });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain("quota");
      expect(JSON.stringify(result)).toContain(queryId); expect(JSON.stringify(result)).not.toContain("PRIVATE fixture");
      expect(JSON.stringify(result)).not.toContain("foreign.example"); expect(executor).toHaveBeenCalledOnce();
    } finally { await link.close(); }
  });

  it("returns the shared client's public result, stripping private claim fields and using no environment key", async () => {
    vi.stubEnv("KERYX_API_KEY", "kx_live_PRIVATE_fixture");
    const fetcher = vi.fn<typeof fetch>(async () => hostedResponse());
    const executor: typeof researchSponsored = (args, options) => researchSponsored(args, { ...options, fetch: fetcher });
    const link = await connection({ baseUrl, executor });
    try {
      const result = await link.client.callTool({ name: "ask_keryx_sponsored", arguments: { ...input, budget: 0 } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject(completed());
      expect(JSON.stringify(result)).not.toContain("PRIVATE fixture");
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0];
      expect(String(url)).toBe(`${baseUrl}/api/v1/chat/completions`);
      expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer keryx");
      expect(JSON.stringify(init)).not.toContain("kx_live_PRIVATE_fixture");
      expect(JSON.parse(String(init?.body))).toMatchObject({ budget: 0 });
    } finally { await link.close(); }
  });

  it("actual stdio entry registration handles a sponsored-only call without loading custody, funding or payment", async () => {
    vi.stubEnv("KERYX_NETWORK", "arcTestnet"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet");
    vi.stubEnv("KERYX_BASE_URL", baseUrl); vi.stubEnv("KERYX_API_KEY", undefined);
    vi.stubEnv("KERYX_BUYER_PRIVATE_KEY", undefined); vi.stubEnv("KERYX_BUYER_PAYEE", undefined);
    const custody = await import("../lib/payments/persistent-treasury-wallet.ts");
    const funding = await import("./local-funding.mts"), payment = await import("./local-payment.mts");
    const load = vi.spyOn(custody, "loadPersistentTreasuryWallet").mockImplementation(() => { throw new Error("Custody forbidden"); });
    const fund = vi.spyOn(funding, "ensureLocalFunding").mockRejectedValue(new Error("Funding forbidden"));
    const pay = vi.spyOn(payment, "payForResearch").mockRejectedValue(new Error("Payment forbidden"));
    const fetcher = vi.fn<typeof fetch>(async () => hostedResponse()); vi.stubGlobal("fetch", fetcher);
    let registered: McpServer | undefined;
    const startup = vi.spyOn(McpServer.prototype, "connect").mockImplementation(async function (this: McpServer) { registered = this; });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await import("./keryx-mcp-server.mts"); startup.mockRestore();
    expect(registered).toBeDefined();
    const link = await connect(registered!);
    try {
      const tools = await link.client.listTools();
      expect(tools.tools.some(t => t.name === "ask_keryx")).toBe(true);
      expect(tools.tools.some(t => t.name === "ask_keryx_sponsored")).toBe(true);
      const result = await link.client.callTool({ name: "ask_keryx_sponsored", arguments: { ...input, mode: "quick", budget: 0 } });
      expect(result.isError).not.toBe(true); expect(result.structuredContent).toMatchObject(completed());
      expect(load).not.toHaveBeenCalled(); expect(fund).not.toHaveBeenCalled(); expect(pay).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(String(fetcher.mock.calls[0][0])).toBe(`${baseUrl}/api/v1/chat/completions`);
    } finally { await link.close(); }
  }, 30_000);
});
