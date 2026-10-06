import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { operatorBusinessStatusSchema } from "./contracts";

/** Discovery only. The shared contract grants no signer, job or scheduler access. */
export function registerOperatorDiscovery(server: McpServer, read: () => Promise<unknown>) {
  server.registerTool("keryx_operator_status", {
    title: "Keryx business Operator status",
    description: "Observe public prepaid research operations, queue and hold/review rationale. No spending or execution authority; exact books and customer jobs stay private.",
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(operatorBusinessStatusSchema.parse(await read())) }] };
    } catch {
      return { isError: true, content: [{ type: "text" as const, text: "Operator observation unavailable. This tool did not execute or fund a job." }] };
    }
  });
}
