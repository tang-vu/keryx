import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { acceptanceInputSchema, deliverableIdSchema, type AcceptanceInput, type AcceptanceSnapshot } from "./contracts";

export function registerAcceptanceTools(server: McpServer, operations: { read(id: string): Promise<AcceptanceSnapshot>; submit(id: string, input: AcceptanceInput): Promise<AcceptanceSnapshot> }) {
  const result = async (action: () => Promise<AcceptanceSnapshot>) => {
    try { const body = await action(); return { content: [{ type: "text" as const, text: JSON.stringify(body) }], structuredContent: body }; }
    catch { return { isError: true, content: [{ type: "text" as const, text: "Deliverable acceptance refused or unavailable. Use the original customer's explicit deliverable scope and read the current exact version. No revision, research, payment or refund was executed." }] }; }
  };
  server.registerTool("deliverable_acceptance_read", {
    title: "Read your delivered-version acceptance", description: "Owner-only ordinary prepaid A2A deliverable state. Requires explicit deliverable:read. Historical remedy:none and missing response window remain visible. Native/enrolled, Monthly, private v2 and browser-only originals are unavailable. Not source-decision agreement or semantic verification.",
    inputSchema: z.object({ id: deliverableIdSchema }).strict(), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ id }) => result(() => operations.read(id)));
  server.registerTool("deliverable_acceptance_submit", {
    title: "Record your deliverable choice or request", description: "Record Accept, Request revision or Reject for the original customer's exact retained delivery. Requires explicit deliverable:write, expected current revision/digests and an idempotency key. Reason is private; publishState explicitly shares state/timestamp only. Request storage does not execute a revision/refund, recharge, change reservations or claw back rewards. Your MCP client may retain private messages.",
    inputSchema: z.object({ id: deliverableIdSchema, submission: acceptanceInputSchema }).strict(), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ id, submission }) => result(() => operations.submit(id, acceptanceInputSchema.parse(submission))));
}
