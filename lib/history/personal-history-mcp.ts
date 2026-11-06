import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RUN_SURFACES } from "../research/run-provenance";
import { historyDateSchema, historyInputSchema, type HistoryInput, type HistoryPage } from "./personal-history";

export function registerHistoryTool(server: McpServer, read: (input: HistoryInput) => Promise<HistoryPage>) {
  server.registerTool("history_read", {
    title: "Read your attributed dispatch history",
    description: "Read bounded pages of the verified API-key wallet's ordinary current-store runs. Requires explicit history:read. Literal case-sensitive question search; storeNetwork describes the deployment, not per-run settlement. Recorded spend/allocation is not a payment receipt. No wallet selector, linked accounts, archive, private jobs, research or payment.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe("Maximum rows in this page, 1-50 inclusive; defaults to 25."),
      cursor: z.string().max(1600).optional().describe("Opaque cursor from your previous page with identical filters; preserve it exactly."),
      search: z.string().max(200).optional().describe("Literal case-sensitive substring in your recorded questions, up to 200 characters."),
      surface: z.enum(RUN_SURFACES).optional().describe("Filter by recorded originating surface; unknown retains missing provenance."),
      funding: z.enum(["browser-recorded", "other-or-unknown"]).optional().describe("Filter the recorded funding label; this label does not verify settlement."),
      from: historyDateSchema.optional().describe("Inclusive creation-time lower bound in canonical UTC with milliseconds, e.g. 2026-01-01T00:00:00.000Z."),
      to: historyDateSchema.optional().describe("Inclusive creation-time upper bound in the same canonical UTC format; must not precede from."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    try { const body = await read(historyInputSchema.parse(input));
      return { content: [{ type: "text" as const, text: JSON.stringify(body) }], structuredContent: body };
    } catch { return { isError: true, content: [{ type: "text" as const, text: "Personal history refused or unavailable. Use an owner key with explicit history:read and valid bounded filters. This tool performs no research or payment." }] }; }
  });
}
