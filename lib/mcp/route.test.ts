import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isAllowedMcpOrigin, POST } from "../../app/mcp/route";

const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function request(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/mcp", {
    method: "POST",
    headers: { ...headers, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe("/mcp", () => {
  it("serves MCP initialize over stateless Streamable HTTP", async () => {
    const response = await POST(
      request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "route-test", version: "1.0.0" },
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.serverInfo.name).toBe("keryx");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("lists the remote research tools without running a paid dispatch", async () => {
    const response = await POST(
      request({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "research",
      "keryx_status",
    ]);
  });

  it("rejects an untrusted browser Origin", async () => {
    const req = request(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { origin: "https://evil.example" },
    );
    expect(isAllowedMcpOrigin(req)).toBe(false);

    const response = await POST(req);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ message: "Forbidden Origin header." }),
      }),
    );
  });
});
