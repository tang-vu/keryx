import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildEvidenceDraft, EVIDENCE_DRAFT_NOTICE } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";

export function evidenceDraftTool(input: { draft: unknown }) {
  try {
    const draft = buildEvidenceDraft(input.draft), exports = exportEvidenceDraft(input.draft);
    const statements = draft.themes.flatMap(theme => theme.statements);
    return { structuredContent: { draft, exports }, content: [{ type: "text" as const,
      text: `${EVIDENCE_DRAFT_NOTICE}\n${draft.claims.length} claim spans; ${draft.excerpts.length} matching retained excerpts; ${exports.referenceCount} cited exact records; ${statements.filter(row => row.status !== "withheld").length} draft statements exported, ${statements.filter(row => row.status === "withheld").length} withheld. ${draft.reading.unread.length} caller-observed unread; ${draft.reading.unavailable.length} caller-observed unavailable; ${draft.reading.unknown.length} unknown reading status. No automatic support verdict is issued.` }] };
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
    description: "Assemble user-selected claim spans and related-work quote themes from saved Include paper records and caller-supplied retained Keryx report rows. A theme may carry author-written statements (contribution, agreement, disagreement, gap); a statement naming a paper is exported only with a citation and a selected retained excerpt from each named paper, otherwise it is withheld. Exported citations and BibTeX/RIS entries are checked to correspond one to one. Exact version/excerpt matching does not authenticate imported reports or verify semantic support. No fetching, model, database, history, payment or reward I/O. Inputs and returned draft can be retained by your MCP client; choose that client’s privacy settings before sharing private passages.",
    inputSchema: { draft: z.unknown().describe("Version-1 private-evidence-draft contract, at most 65536 UTF-8 bytes. Optional assembly {mode:append} or {mode:regenerate,themeId} quotes retained text without model calls; optional readingStatuses separates caller-observed unread/unavailable records from unknown status. See docs/evidence-drafts.md and docs/engineering/related-work283-completion-2026-10-12.md.") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, evidenceDraftTool);
}
