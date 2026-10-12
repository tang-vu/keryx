import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildEvidenceProcurement, PROCUREMENT_NOTICE } from "./engine";

export async function evidenceProcurementTool(input: { packet: unknown }) {
  try {
    const procurement = await buildEvidenceProcurement(input.packet);
    return {
      structuredContent: { procurement },
      content: [{ type: "text" as const, text: PROCUREMENT_NOTICE }],
    };
  } catch {
    // Private packet values and schema diagnostics stay out of tool error text.
    return { isError: true, content: [{ type: "text" as const,
      text: "Invalid private evidence procurement. Use the bounded version-1 packet; no provider contacted or payment started." }] };
  }
}

/** Hosted and stdio callers use the same local transformation. The MCP client
 * may retain private tool input/output; this tool cannot control that retention. */
export function registerEvidenceProcurementTool(server: McpServer) {
  server.registerTool("evidence_procurement", {
    title: "Plan and inspect private evidence procurement",
    description: "Assess missing evidence requirements, supplied provider offers, selections, deliveries and caller reviews with the shared private evidence procurement contract. Amounts are exact integer micro-USDC. Signature and content-binding checks do not establish delivery quality, buyer authority, payment or settlement. No fetching, model, provider, database, history, purchase, escrow or reward I/O. Caller selections and reviews are assertions, not financial authorization. Inputs and results may be retained by your MCP client; choose its privacy settings before sharing private material.",
    inputSchema: { packet: z.unknown().describe("Version-1 private-evidence-procurement packet, at most 65536 UTF-8 bytes. Supply original inputs, never a derived procurement result.") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, evidenceProcurementTool);
}
