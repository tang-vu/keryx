import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ownedInputSchema, ownedPageSchema, type OwnedHistoryInput, type OwnedHistoryPage } from "./owned-history";
import type { OwnedHistoryExport } from "./owned-history-export";
export function registerOwnedHistoryTools(server: McpServer, read: (input: OwnedHistoryInput) => Promise<OwnedHistoryPage>,
  exportHistory: (input: OwnedHistoryInput) => Promise<OwnedHistoryExport>) {
  const inputSchema = ownedInputSchema;
  for (const [name, title, handler] of [["history_owned_read", "Read your owned history", read], ["history_export", "Export your owned history metadata", exportHistory]] as const) {
    server.registerTool(name, { title,
      description: "Same owner-private v2 contract as /api/me/asks. Explicit history:read required. Current store, bounded filters/keysets; missing membership/claims stay explicit. Export has explicit truncation/continuation. No research, signer, payment, public-owner selector or mutation authority.",
      inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async raw => {
      try {
        const value = await handler(ownedInputSchema.parse(raw));
        if (name === "history_owned_read") ownedPageSchema.parse(value);
        return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
      } catch { return { isError: true, content: [{ type: "text" as const, text: "Owned history refused or unavailable. An explicit owner history scope and admitted privacy/storage capabilities are required. No research or payment performed." }] }; }
    });
  }
}
