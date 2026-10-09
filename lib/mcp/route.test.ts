import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { POST } from "../../app/mcp/route";
import { isAllowedMcpOrigin, isPaperLookupCall, normalizeMcpClient, researchCallCount } from "./route-helpers";
import * as apiKeys from "../api-keys";
import * as database from "../db";

const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function request(
  body: unknown,
  extraHeaders: Record<string, string> = {},
  query = "",
) {
  return new NextRequest(`http://localhost:3000/mcp${query}`, {
    method: "POST",
    headers: { ...headers, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe("/mcp", () => {
  it("serves a public metadata call without research key resolution or database access", async () => {
    const verify = vi.spyOn(apiKeys, "verifyApiKey").mockImplementation(async () => { throw new Error("Metadata must not verify research credentials"); });
    const db = vi.spyOn(database, "getDb").mockImplementation(async () => { throw new Error("Metadata must not open the database"); });
    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Metadata must not use external transport"));
    const call = { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "paper_lookup", arguments: { query: "2005.11401v4" } } };
    try {
      const response = await POST(request(call, { authorization: `Bearer ${["kx", "live", "synthetic"].join("_")}` }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: { structuredContent: { scope: "bibliography-only", totalWorks: 1, providers: [] } } });
      expect(verify).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
      expect(isPaperLookupCall(call)).toBe(true);
      expect(isPaperLookupCall([call, { ...call, params: { name: "research" } }])).toBe(false);
      expect(isPaperLookupCall({ ...call, method: "tools/list" })).toBe(false);
      expect(isPaperLookupCall({ ...call, params: { name: "research" } })).toBe(false);
    } finally { verify.mockRestore(); db.mockRestore(); http.mockRestore(); }
  });
  it("rejects oversized bodies before tool dispatch and contains malformed JSON", async () => {
    const response = await POST(request({ jsonrpc: "2.0", method: "tools/call", params: { name: "research", arguments: { question: "x".repeat(65536) } } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32700);
    expect((await POST(request(null))).status).toBe(400);
    const malformed = new NextRequest("http://localhost:3000/mcp", { method: "POST", headers, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
  });

  it("counts deeply nested batches without exhausting the call stack", () => {
    let body: unknown = { method: "tools/call", params: { name: "research" } };
    for (let i = 0; i < 10000; i++) body = [body];
    expect(researchCallCount(body)).toBe(1);
  });

  it("normalizes setup channels to a bounded telemetry vocabulary", () => {
    expect(normalizeMcpClient("CODEX")).toBe("codex");
    expect(normalizeMcpClient("claude")).toBe("claude");
    expect(normalizeMcpClient("cursor")).toBe("cursor");
    expect(normalizeMcpClient(null)).toBe("direct");
    expect(normalizeMcpClient("anything-user-controlled")).toBe("other");
  });

  it("counts paid research calls inside a JSON-RPC batch", () => {
    expect(
      researchCallCount([
        { method: "tools/call", params: { name: "research" } },
        { method: "tools/call", params: { name: "keryx_status" } },
        { method: "tools/call", params: { name: "research" } },
      ]),
    ).toBe(2);
  });

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
      "evidence_draft",
      "deliverable_acceptance_read",
      "deliverable_acceptance_submit",
      "operator_obligations_read",
      "paper_lookup",
      "research",
      "keryx_status",
      "research_monthly",
      "keryx_operator_status",
      "keryx_public_job_ledger",
      "profile_read",
      "profile_update",
      "history_read",
      "profile_identities_read",
    ]);
    expect(body.result.tools.find((tool: { name: string }) => tool.name === "keryx_operator_status").annotations)
      .toEqual(expect.objectContaining({ readOnlyHint: true, destructiveHint: false }));
  });

  it("rejects a batch that would run more than one treasury-funded research call", async () => {
    const call = (id: number) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "research",
        arguments: { question: `Question ${id}` },
      },
    });
    const response = await POST(request([call(1), call(2)]));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          message: "A request may contain at most one treasury-funded research call.",
        }),
      }),
    );
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
