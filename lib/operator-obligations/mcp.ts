import { parseNativeObligationInspection } from "./contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Share the capability across independent hosted/packaged SDK copies. No owner arguments. */
export function registerObligationInspection(server: McpServer, read: () => Promise<unknown>) {
  server.registerTool("operator_obligations_read", { title: "Read delegated Operator obligations",
    description: "Read a private conservative obligation projection for the exact server-delegated reader with explicit operator:read API-key scope. Disabled without protected reader/role configuration. Partial native history remains unknown with zero safe/advisory surplus. No cash probe, signer, custody, spending, release, refund or scheduler authority. No caller owner/role selectors.",
    inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => {
    try {
      const value = parseNativeObligationInspection(await read());
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
    } catch { return { isError: true, content: [{ type: "text" as const, text: "Operator inspection refused or unavailable. No research, payment or treasury action was performed." }] }; }
  });
}
