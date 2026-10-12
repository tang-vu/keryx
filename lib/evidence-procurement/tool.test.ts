import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildEvidenceProcurement, PROCUREMENT_NOTICE } from "./engine";
import { evidenceProcurementTool, registerEvidenceProcurementTool } from "./tool";
import { evidenceProcurementOpenApiPath } from "./openapi";

const packet = () => ({ version: 1, scope: "private-evidence-procurement", request: {
  id: "mcp-fixture", network: "eip155:5042002", decision: "Which benchmark evidence is missing?",
  budgetMicroUsdc: "50000", expiresAt: "2099-10-13T12:00:00.000Z",
  requirements: [{ id: "latency", question: "What is measured latency?", priority: 10, status: "missing" }],
}, offers: [], selectedOfferIds: [], deliveries: [], reviews: [] });
afterEach(() => vi.restoreAllMocks());

it("exposes the same CPU-only contract through the actual MCP SDK", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T12:00:00.000Z"));
  const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No external transport"));
  const server = new McpServer({ name: "procurement-fixture", version: "1" }); registerEvidenceProcurementTool(server);
  const client = new Client({ name: "fixture", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const tools = (await client.listTools()).tools; expect(tools.map(tool => tool.name)).toEqual(["evidence_procurement"]);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    const result = await client.callTool({ name: "evidence_procurement", arguments: { packet: packet() } });
    expect(result.isError).not.toBe(true); expect(result.structuredContent).toEqual({ procurement: await buildEvidenceProcurement(packet()) });
    expect(result.content).toEqual([{ type: "text", text: PROCUREMENT_NOTICE }]); expect(http).not.toHaveBeenCalled();
  } finally { await client.close(); await server.close(); }
});
it("refuses derived output and emits fixed private errors", async () => {
  for (const value of [{ ...packet(), secret: "SECRET_PACKET" }, await buildEvidenceProcurement(packet()), null]) {
    const result = await evidenceProcurementTool({ packet: value }); expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SECRET_PACKET"); expect(result).not.toHaveProperty("structuredContent");
  }
});
it("publishes the strict original packet shape and the private authentication boundary", () => {
  const operation = evidenceProcurementOpenApiPath["/api/research/evidence-procurement"].post;
  expect(operation.security).toEqual([{ ApiKeyAuth: [] }, { WebSession: [] }]);
  const schema = operation.requestBody.content["application/json"].schema;
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(["version", "scope", "request", "offers", "selectedOfferIds", "deliveries", "reviews"]);
  expect(schema.properties.offers.items.required).toContain("deliverable");
  expect(schema.properties.reviews.items.required).toContain("reviewer");
  expect(operation.description).toContain("65536 actual UTF-8 bytes"); expect(operation.description).toContain("Authentication precedes body reading");
});
