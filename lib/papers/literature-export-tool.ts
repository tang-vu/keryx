import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exportLiterature, literatureExportInput } from "./literature-export";

export function literatureExportTool(input: Parameters<typeof exportLiterature>[0]) {
  try {
    const result = exportLiterature(input);
    return { structuredContent: result, content: [{ type: "text" as const, text: result.content }] };
  } catch {
    return { isError: true, content: [{ type: "text" as const,
      text: "Literature export refused. Supply a valid bounded private library backup and an explicit reference format. No source lookup, research or purchase started." }] };
  }
}

/** Local stdio operation. Inputs may be retained by the caller's MCP client. */
export function registerLiteratureExportTool(server: McpServer) {
  server.registerTool("export_saved_literature", {
    title: "Export saved literature references locally",
    description: "Convert a caller-supplied Keryx personal-bibliography v1 JSON backup (at most 1048576 UTF-8 bytes) to BibTeX, RIS or CSL-JSON, optionally selecting one saved screening state. Keeps saved order, exact paper versions and metadata provenance. Output omits private review title, question, notes and screening decisions. Metadata only: no read, citation, peer-review or settlement certification. No fetching, file access, model, database, wallet or payment I/O. Your MCP client may retain the full supplied backup, including private notes; prefer the browser tool when those bytes should remain in browser memory.",
    inputSchema: literatureExportInput.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, literatureExportTool);
}
