import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { privateProfileInputSchema, type PrivateProfileInput } from "./private-profile";

export interface ProfileToolOperations { read(): Promise<unknown>; update(input: PrivateProfileInput): Promise<unknown> }
/** Both transports bind owner/scopes outside the model-supplied argument schema. */
export function registerProfileTools(server: McpServer, operations: ProfileToolOperations) {
  const result = async (action: () => Promise<unknown>) => {
    try { const body = await action(); return { content: [{ type: "text" as const, text: JSON.stringify(body) }], structuredContent: body as Record<string, unknown> }; }
    catch { return { isError: true, content: [{ type: "text" as const, text: "Private profile access refused or unavailable. Use an owner key with the explicit profile scope; this operation performs no research or payment." }] }; }
  };
  server.registerTool("profile_read", { title: "Read your private profile", description: "Read the verified key owner's private profile and attributed activity. Requires explicit profile:read scope. No public identity, research or payment.",
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, () => result(operations.read));
  server.registerTool("profile_update", { title: "Update your private profile", description: "Replace the verified key owner's private display name, handle, one-line bio/purpose and links. Requires explicit profile:write scope. No wallet selector or identity verification; no payment/history changes.",
    inputSchema: { profile: privateProfileInputSchema.describe("Complete replacement; empty text clears a field. Links are bounded HTTPS links to the allowed providers or a public website.") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, ({ profile }) => result(() => operations.update(privateProfileInputSchema.parse(profile))));
}
