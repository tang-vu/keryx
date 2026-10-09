import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { identitySnapshotSchema } from "./verified-identities";

/** Both transports bind the verified owner outside model arguments. OAuth stays interactive. */
export function registerIdentityReadTool(server: McpServer, read: () => Promise<unknown>) {
  server.registerTool("profile_identities_read", {
    title: "Read your verified profile identities",
    description: "Read only the verified key owner's saved ORCID/GitHub identities. Requires explicit profile:read scope. No wallet selector, provider OAuth, linking, unlinking, research or payment. Link identities interactively in your private profile browser page.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      const body = identitySnapshotSchema.parse(await read());
      return { content: [{ type: "text" as const, text: JSON.stringify(body) }], structuredContent: body };
    } catch {
      return { isError: true, content: [{ type: "text" as const, text: "Verified identity access refused or unavailable. Use an owner key with explicit profile:read scope. Linking requires interactive browser consent; this read performs no provider OAuth, research or payment." }] };
    }
  });
}
