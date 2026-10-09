import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RUN_SURFACES } from "../research/run-provenance";
import { historyDateSchema, historyInputSchema, type HistoryInput, type HistoryPage } from "./personal-history";

export function registerHistoryTool(server: McpServer, read: (input: HistoryInput) => Promise<HistoryPage>) {
  server.registerTool("history_read", {
    title: "Read your attributed dispatch history",
    description: "Read bounded pages of the verified API-key wallet's ordinary current-store runs. Requires explicit history:read. Literal case-sensitive question search; storeNetwork describes the deployment, not per-run settlement. Recorded spend/allocation is not a payment receipt. No wallet selector, linked accounts, archive, private jobs, research or payment.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(1600).optional(),
      search: z.string().max(200).optional(), surface: z.enum(RUN_SURFACES).optional(),
      funding: z.enum(["browser-recorded", "other-or-unknown"]).optional(), from: historyDateSchema.optional(), to: historyDateSchema.optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    try { const body = await read(historyInputSchema.parse(input));
      return { content: [{ type: "text" as const, text: JSON.stringify(body) }], structuredContent: body };
    } catch { return { isError: true, content: [{ type: "text" as const, text: "Personal history refused or unavailable. Use an owner key with explicit history:read and valid bounded filters. This tool performs no research or payment." }] }; }
  });
}
