import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildEvidenceDraft, EVIDENCE_DRAFT_NOTICE } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";

export function evidenceDraftTool(input: { draft: unknown }) {
  try {
    const draft = buildEvidenceDraft(input.draft), exports = exportEvidenceDraft(input.draft);
    return { structuredContent: { draft, exports }, content: [{ type: "text" as const,
      text: `${EVIDENCE_DRAFT_NOTICE}\n${draft.claims.length} claim spans; ${draft.excerpts.length} matching retained excerpts; ${exports.referenceCount} cited exact records. No automatic support verdict is issued.` }] };
  } catch {
    // Never echo private input or schema diagnostics into logs/error text.
    return { isError: true, content: [{ type: "text" as const, text: "Invalid or changed private evidence draft. Use the version-1 bounded contract; no research or payment started." }] };
  }
}

/** Same zero-I/O handler in hosted and caller-funded stdio servers. The MCP client
 * may retain its tool messages; this tool cannot promise client-side deletion. */
export function registerEvidenceDraftTool(server: McpServer) {
  server.registerTool("evidence_draft", {
    title: "Assemble a private retained-evidence draft",
    description: "Assemble user-selected claim spans and related-work quote themes from saved Include paper records and caller-supplied retained Keryx report rows. Exact version/excerpt matching does not authenticate imported reports or verify semantic support. No fetching, model, database, history, payment or reward I/O. Inputs and returned draft can be retained by your MCP client; choose that client’s privacy settings before sharing private passages.",
    inputSchema: { draft: z.unknown().describe("Version-1 private-evidence-draft contract, at most 65536 UTF-8 bytes. See docs/evidence-drafts.md.") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, evidenceDraftTool);
}
