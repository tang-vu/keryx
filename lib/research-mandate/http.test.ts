import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { GET, POST } from "../../app/api/research/mandates/route";
import { POST as mcpPost } from "../../app/api/research/mandates/mcp/route";
import { mandateExample } from "./example";
import { MAX_MANDATE_BYTES } from "./http";

const url = "https://mandates.example/api/research/mandates";
const request = (body: string, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
describe("stateless policy surfaces", () => {
  it("advertises a synthetic example and returns a no-store assessment without permission", async () => {
    const metadata = await GET(); expect(metadata.headers.get("cache-control")).toBe("no-store");
    expect(await metadata.json()).toMatchObject({ executionAuthorized: false, contractStatus: "undeployed-candidate" });
    const response = await POST(request(JSON.stringify(mandateExample())));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ executionAuthorized: false, basis: "caller-supplied-policy-and-books" });
  });
  it("bounds both declared and actual body bytes, rejects unsafe origins/media/JSON, and never echoes inputs", async () => {
    for (const [input, status] of [
      [request("{", {}), 400], [request("synthetic-private-marker", { "Content-Type": "text/plain" }), 415],
      [request("{}", { Origin: "https://other.example" }), 403],
      [request("{}", { "Content-Length": String(MAX_MANDATE_BYTES + 1) }), 413],
      [request("x".repeat(MAX_MANDATE_BYTES + 1)), 413],
      [request(JSON.stringify({ apiKey: "synthetic-private-marker" })), 400],
    ] as const) {
      const response = await POST(input); expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("synthetic-private-marker");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("completes the actual stateless MCP initialize/list/call exchange and shares the same authority boundary", async () => {
    const client = new Client({ name: "synthetic-mandate-client", version: "1" });
    const endpoint = new URL(url + "/mcp");
    const transport = new StreamableHTTPClientTransport(endpoint, { fetch: async (input, init) => mcpPost(new Request(String(input), init)) });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(["research_mandate_assess", "research_mandate_example"]);
      const example = await client.callTool({ name: "research_mandate_example", arguments: { network: "eip155:5042002" } });
      expect(example.structuredContent).toMatchObject({ synthetic: true, executionAuthorized: false });
      const payload = example.structuredContent as { input: unknown };
      const input = payload.input;
      const result = await client.callTool({ name: "research_mandate_assess", arguments: { input } });
      expect(result.structuredContent).toMatchObject({ executionAuthorized: false, basis: "caller-supplied-policy-and-books", identity: { network: "eip155:5042002" } });
      const invalid = await client.callTool({ name: "research_mandate_assess", arguments: { input: { execute: true } } });
      expect(invalid.isError).toBe(true);
    } finally { await client.close(); }
  });
});
