import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { inspectLiterature, literatureInspectionInput } from "./literature-inspection";

export function literatureInspectionTool(input: Parameters<typeof inspectLiterature>[0]) {
  try {
    const result = inspectLiterature(input);
    return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch {
    return { isError: true, content: [{ type: "text" as const,
      text: "Literature inspection refused. Supply a valid bounded private library backup. No source lookup, research or purchase started." }] };
  }
}

export function registerLiteratureInspectionTool(server: McpServer) {
  server.registerTool("inspect_saved_literature", {
    title: "Inspect a saved literature backup locally",
    description: "Validate a caller-supplied Keryx personal-bibliography v1 JSON backup (at most 1048576 UTF-8 bytes) and return aggregate counts for saved records, personal screening, repositories, recorded publication types and missing metadata. Separate paper versions remain separate records. Gap counts overlap and missing fields remain unknown; no quality score, paper lookup, reading, peer-review, withdrawal or settlement verification. Output omits review title, question, notes, paper titles, authors, identifiers and URLs. No file, network, model, database, wallet or payment I/O. Your MCP client may retain the entire supplied backup, including private notes; prefer the browser workspace when those bytes should remain there.",
    inputSchema: literatureInspectionInput.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, literatureInspectionTool);
}
