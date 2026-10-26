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
    description: "Validate a caller-supplied Keryx personal-bibliography v1 JSON backup and return aggregate counts for saved records, personal screening, repositories, recorded publication types and missing metadata. Optional baselineBackup adds a redacted comparison: baseline is before, backup is after, regardless of timestamps. Each supplied JSON string is limited to 1048576 UTF-8 bytes and fully validated. Records match only by exact saved URL; separate versions remain separate. Report added/removed records, overlapping retained-record field changes, retained relative order and review-focus changes. Metadata observation timestamps are separate from bibliographic changes. Output omits actual private review text, notes and paper identities. Counts establish no quality, lookup, reading, peer-review, withdrawal, authenticity or settlement claim. No file, network, model, database, wallet or payment I/O. Your MCP client may retain both complete supplied backups, including private notes; prefer the browser workspace when those bytes should remain there.",
    inputSchema: literatureInspectionInput.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, literatureInspectionTool);
}
