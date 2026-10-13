import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { evaluateMandate, mandateInputSchema } from "./evaluate";
import { mandateExample } from "./example";

export function createMandateMcpServer(): McpServer {
  const server = new McpServer({ name: "keryx-research-mandates", version: "1.0.0" });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  server.registerTool("research_mandate_assess", { description: "Assess caller-supplied research policy and fresh books. Never authorizes or executes payment; no RPC, model call or persistence.",
    inputSchema: { input: mandateInputSchema }, annotations }, async ({ input }) => {
    const result = evaluateMandate(input);
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result } };
  });
  server.registerTool("research_mandate_example", { description: "Generate an explicitly synthetic research mandate input. Values are examples, not live wallet or model evidence.",
    inputSchema: { network: z.enum(["eip155:5042", "eip155:5042002"]).optional() }, annotations }, async ({ network }) => {
    const input = mandateExample(); if (network) input.network = network;
    return { content: [{ type: "text", text: JSON.stringify(input) }], structuredContent: { synthetic: true, executionAuthorized: false, input } };
  });
  return server;
}
