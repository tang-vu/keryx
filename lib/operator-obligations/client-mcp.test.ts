import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { nativeInspectionFixture } from "../../test-support/operator-obligations";
import { createObligationClient } from "./client";
import { registerObligationInspection } from "./mcp";

describe("private read-only transport contract", () => {
  it("sends one fixed HTTPS credential-only GET without wallet or selectors", async () => {
    const transport = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json(nativeInspectionFixture()));
    const value = await createObligationClient("https://inspect.example", () => `kx_live_${"a".repeat(96)}`, transport).read();
    expect(value.projection.status).toBe("unknown"); expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0]; expect(String(url)).toBe("https://inspect.example/api/operator/obligations");
    expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store" }); expect(init?.body).toBeUndefined();
  });
  it.each(["http://inspect.example", "https://user:password@inspect.example", "https://inspect.example/path", "https://inspect.example?q=selector", "https://inspect.example#fragment"])("rejects ambiguous/unsafe origin %s", url => {
    expect(() => createObligationClient(url, () => "")).toThrow();
  });
  it("does not fetch without the exact key format and does not expose a denial body", async () => {
    const transport = vi.fn(async () => new Response("sensitive backend text", { status: 401 }));
    await expect(createObligationClient("https://inspect.example", () => "invalid", transport).read()).rejects.toThrow("refused or unavailable"); expect(transport).not.toHaveBeenCalled();
    await expect(createObligationClient("https://inspect.example", () => `kx_live_${"a".repeat(96)}`, transport).read()).rejects.toThrow("refused or unavailable"); expect(transport).toHaveBeenCalledOnce();
  });
  it("rejects oversized response and positive native surplus claims", async () => {
    const key = () => `kx_live_${"a".repeat(96)}`;
    await expect(createObligationClient("https://inspect.example", key, async () => new Response(" ".repeat(32769))).read()).rejects.toThrow("size limit");
    const value = nativeInspectionFixture(); value.projection.advisorySurplusMicroUsdc = "1";
    await expect(createObligationClient("https://inspect.example", key, async () => Response.json(value)).read()).rejects.toThrow("refused or unavailable");
  });
  it("actual MCP SDK discovers no books, returns the exact unknown contract and redacts errors", async () => {
    const server = new McpServer({ name: "obligation-fixture", version: "1" }); let fail = false;
    const read = vi.fn(async () => { if (fail) throw new Error("private journal detail"); return nativeInspectionFixture(); }); registerObligationInspection(server, read);
    const client = new Client({ name: "inspection-reader", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a); await client.connect(b); const listed = await client.listTools(); expect(read).not.toHaveBeenCalled();
      const tool = listed.tools.find(t => t.name === "operator_obligations_read")!; expect(tool.annotations?.readOnlyHint).toBe(true); expect(JSON.stringify(listed)).not.toContain("500000");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect((await client.callTool({ name: "operator_obligations_read", arguments: { custodyWallet: "other" } })).isError).toBe(true); expect(read).not.toHaveBeenCalled();
      const result = await client.callTool({ name: "operator_obligations_read", arguments: {} }); expect(result.isError).not.toBe(true); expect(result.structuredContent).toEqual(nativeInspectionFixture());
      fail = true; const error = await client.callTool({ name: "operator_obligations_read", arguments: {} }); expect(error.isError).toBe(true); expect(JSON.stringify(error)).not.toContain("private journal detail");
    } finally { await client.close(); await server.close(); }
  });
});
