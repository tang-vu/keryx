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
    description: "Convert a caller-supplied Keryx personal-bibliography v1 JSON backup (at most 1048576 UTF-8 bytes) to BibTeX, RIS or CSL-JSON. Optionally supply paperUrls: at most 50 unique exact saved landing URLs, in desired output order; an empty array exports no papers and missing/changed URLs refuse the entire export. An optional screening state further filters that selection. Without paperUrls keeps saved order. Validates the full backup and preserves exact versions/provenance. Output omits private review title, question, notes and screening decisions. Metadata only: no read, citation, peer-review or settlement certification. No fetching, file access, model, database, wallet or payment I/O. Your MCP client may retain the full supplied backup, including private notes; prefer the browser tool when those bytes should remain in browser memory.",
    inputSchema: literatureExportInput.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, literatureExportTool);
}
