import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_COMPARISON_RECEIPT_BYTES, MAX_COMPARISON_TARGETS, ReportComparisonError } from "./report-comparison";
import { compareResearchWithPlan, createReportComparisonPlan, MAX_COMPARISON_PLAN_BYTES, ReportComparisonPlanError } from "./report-comparison-plan";

export async function reportComparisonTool(input: { before: string; after: string; matches?: Array<{ beforeClaimIndex: number; afterClaimIndex: number }>; matchingPlan?: string }) {
  try {
    const comparison = await compareResearchWithPlan(input);
    return { structuredContent: { comparison, matchingPlan: createReportComparisonPlan(comparison) }, content: [{ type: "text" as const,
      text: `${comparison.notice}\n${comparison.summary.comparableTargets} comparable targets; ${comparison.summary.changedTargets} with changed recorded excerpts or reading context. ${comparison.summary.unknownTargets} unknown. Availability: ${comparison.availability}.` }] };
  } catch (error) {
    const code = error instanceof ReportComparisonError || error instanceof ReportComparisonPlanError ? error.code : "invalid-receipt";
    return { isError: true, content: [{ type: "text" as const,
      text: `Saved report comparison refused (${code}). Supply two bounded version-1 receipt JSON strings with matching payload checksums. No research or purchase started.` }] };
  }
}

/** Local stdio only. MCP clients can retain inputs/results in their own history. */
export function registerReportComparisonTool(server: McpServer) {
  server.registerTool("compare_saved_research", {
    title: "Compare two saved research receipts locally",
    description: "Checks both recorded payload SHA-256 digests, then compares retained excerpt rows with exact source/item/URL/version identity and reading context. Unique identical target text is matched automatically; matches can explicitly select one-to-one target pairs. Or supply matchingPlan JSON to restore choices bound to these receipts in this order; never combine both options. Returns a reusable matchingPlan without report text alongside the comparison. Duplicate or renamed targets are not guessed. Missing historical ledgers remain unknown. This is a local stdio operation without fetching, database, model, payment or reward I/O. A checksum is not authenticity, factual support or improvement. Your MCP client may retain all supplied text; use the web file tool for browser-memory-only inspection.",
    inputSchema: {
      before: z.string().max(MAX_COMPARISON_RECEIPT_BYTES).describe("Earlier caller-selected receipt JSON; at most 524288 UTF-8 bytes."),
      after: z.string().max(MAX_COMPARISON_RECEIPT_BYTES).describe("Later caller-selected receipt JSON; at most 524288 UTF-8 bytes."),
      matches: z.array(z.object({ beforeClaimIndex: z.number().int().min(0).max(MAX_COMPARISON_TARGETS - 1),
        afterClaimIndex: z.number().int().min(0).max(MAX_COMPARISON_TARGETS - 1) }).strict()).max(MAX_COMPARISON_TARGETS)
        .optional().describe("Omit for unique exact-text matching; [] intentionally leaves every target unmatched."),
      matchingPlan: z.string().max(MAX_COMPARISON_PLAN_BYTES).optional()
        .describe("Saved keryx-report-matching-v1 JSON, at most 65536 UTF-8 bytes. Must bind the same ordered receipt payload checksums. Mutually exclusive with matches."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, reportComparisonTool);
}
