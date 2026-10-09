import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NextRequest } from "next/server";
import { nativeInspectionFixture, OBLIGATION_FIXTURE_OWNER as READER } from "../../test-support/operator-obligations";
const inspect = vi.hoisted(() => vi.fn());
vi.mock("./inspection", () => ({ inspectOperatorObligations: inspect }));
import { createRemoteMcpServer } from "../mcp/remote-server";
import { POST } from "../../app/mcp/route";
import * as apiKeys from "../api-keys";

describe("actual remote registrations and HTTP access shape", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); inspect.mockReset(); });
  it("binds verified remote operator scope and separately protected reader", async () => {
    vi.stubEnv("KERYX_OPERATOR_OBLIGATION_READER", READER); vi.stubEnv("KERYX_OPERATOR_OBLIGATION_ROLE", "public");
    inspect.mockResolvedValue(nativeInspectionFixture()); const runner = vi.fn();
    const server = createRemoteMcpServer({ budgetCap: 0, actor: READER, operatorScopes: ["operator:read"], clientChannel: "direct" }, runner);
    const client = new Client({ name: "remote-inspection-fixture", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a); await client.connect(b); const tools = await client.listTools(); expect(inspect).not.toHaveBeenCalled();
      expect(tools.tools.some(t => t.name === "operator_obligations_read")).toBe(true);
      const result = await client.callTool({ name: "operator_obligations_read", arguments: {} }); expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(nativeInspectionFixture()); expect(inspect).toHaveBeenCalledWith({ wallet: READER, role: "public" }); expect(runner).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it("actual HTTP wrapper accepts operator-only protocol calls but refuses paid research", async () => {
    vi.stubEnv("KERYX_OPERATOR_OBLIGATION_READER", READER); vi.stubEnv("KERYX_OPERATOR_OBLIGATION_ROLE", "public"); inspect.mockResolvedValue(nativeInspectionFixture());
    vi.spyOn(apiKeys, "verifyApiKey").mockResolvedValue({ walletAddress: READER, keyId: "fixture-auth", scopes: "operator:read", sourceIds: null });
    const call = async (name: string, args: object) => POST(new NextRequest("http://localhost:3000/mcp", { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer kx_live_${"a".repeat(96)}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const response = await call("operator_obligations_read", {}); expect(response.status).toBe(200);
    expect((await response.json()).result.structuredContent).toEqual(nativeInspectionFixture()); expect(inspect).toHaveBeenCalledOnce();
    const research = await call("research", { question: "No funded work", budget: 0.01 }); expect(research.status).toBe(403); expect(inspect).toHaveBeenCalledOnce();
  });
});
