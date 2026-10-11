import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildDraftCheck, DRAFT_CHECK_NOTICE } from "./draft-check";

export function draftCheckTool(input: { check: unknown }) {
  try {
    const check = buildDraftCheck(input.check), { summary } = check;
    return { structuredContent: { check }, content: [{ type: "text" as const,
      text: `${DRAFT_CHECK_NOTICE}\n${summary.claims} claims: ${summary.supported} supported, ${summary.partlySupported} partly supported, ${summary.notFound} not found in the supplied text, ${summary.sourceUnavailable} source unavailable, ${summary.notChecked} not checked. ${check.flags.length} reference or citation flags.` }] };
  } catch {
    // Never echo private input or schema diagnostics into logs/error text.
    return { isError: true, content: [{ type: "text" as const, text: "Invalid private draft check. Use the version-1 bounded contract; no research or payment started." }] };
  }
}

/** Same zero-I/O handler in hosted and caller-funded stdio servers. The MCP client
 * may retain its tool messages; this tool cannot promise client-side deletion. */
export function registerDraftCheckTool(server: McpServer) {
  server.registerTool("draft_check", {
    title: "Check a draft's cited claims against supplied source text",
    description: "Split a private passage into sentences, bind citation markers ([3], \cite{key}, [@key], Author (Year)) to a BibTeX, RIS or DOI/link reference list, and compare each cited sentence with source text you supply. Each verdict (supported, partly-supported, not-found, source-unavailable) carries a verbatim excerpt of that text or states that no supporting passage was found; a source without supplied text is always source-unavailable. Deterministic wording comparison, not semantic review. No fetching, model, database, history, payment or reward I/O. Inputs and results can be retained by your MCP client; choose that client’s privacy settings before sharing private passages.",
    inputSchema: { check: z.unknown().describe("Version-1 private-draft-check contract, at most 65536 UTF-8 bytes. See docs/draft-check.md.") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, draftCheckTool);
}
