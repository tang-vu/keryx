import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { RESEARCH_RECEIPT_SCHEMA } from "../research-receipt-types";
import { registerReportComparisonTool, reportComparisonTool } from "./report-comparison-tool";

const clients: Client[] = [];
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); vi.unstubAllGlobals(); });
function receipt() {
  const payload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { question: "Private question" }, claims: [], citations: [] };
  return JSON.stringify({ payload, integrity: { algorithm: "sha256", canonicalization: "keryx-json-v1", scope: "payload",
    digest: `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}` } });
}
it("compares through the actual local MCP protocol without fetching or credentials", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const server = new McpServer({ name: "local-comparison-test", version: "1" }); registerReportComparisonTool(server);
  const client = new Client({ name: "comparison-client", version: "1" }); clients.push(client);
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  const [tool] = (await client.listTools()).tools;
  expect(tool.name).toBe("compare_saved_research");
  expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(["after", "before", "matches"]);
  const result = await client.callTool({ name: tool.name, arguments: { before: receipt(), after: receipt() } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ comparison: { format: "keryx-report-comparison-v1", sameReceipt: true, availability: "complete" } });
  expect(fetch).not.toHaveBeenCalled();
});
it("does not echo private malformed receipt contents or exception details", async () => {
  const secret = "PRIVATE_FORBIDDEN_WALLET_TOKEN";
  const response = await reportComparisonTool({ before: secret, after: receipt() });
  expect(response.isError).toBe(true); expect(JSON.stringify(response)).not.toContain(secret);
  expect(JSON.stringify(response)).toContain("invalid-receipt");
  expect(response.structuredContent).toBeUndefined();
});
it("refuses a deliberately corrupted checksum even when the receipt remains parseable", async () => {
  const bad = JSON.parse(receipt()); bad.payload.dispatch.question = "A changed payload";
  const result = await reportComparisonTool({ before: receipt(), after: JSON.stringify(bad) });
  expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
});
