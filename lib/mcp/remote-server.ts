import { demoteSyntheticEvidence } from "../research/evidence-provenance";
import { surfaceResearch } from "../research/surface-result";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { collectRun } from "../agent";
import { config } from "../config";
import { resolveModelChoice } from "../llm";
import type { McpClientChannel, QueryRun } from "../types";
import { registerMonthlyDiscovery } from "../monthly/mcp-discovery";
import { quoteResearchMonthly } from "../monthly/quote";
import { reasoningServingText } from "../llm/reasoning-telemetry";

export interface RemoteMcpAccess {
  budgetCap: number;
  /** Wallet from a verified Keryx API key. Anonymous MCP clients leave this absent. */
  actor?: string;
  /** Self-declared setup URL channel. Telemetry only; never identity or payment authority. */
  clientChannel: McpClientChannel;
}

type ResearchRunner = typeof collectRun;

export function remoteResearchResult(run: QueryRun) {
  run = demoteSyntheticEvidence(run);
  return {
    queryId: run.id,
    answer: run.answer,
    ...surfaceResearch(run),
    totalToCreatorsUsdc: run.totalToCreators,
    confidence: run.confidence,
    engine: run.engine,
    paymentAttempts: run.paymentAttempts ?? 0,
    settledPayments: run.settledPayments ?? 0,
    dispatchUrl: `${config.baseUrl}/dispatch/${run.id}`,
  };
}

function researchText(result: ReturnType<typeof remoteResearchResult>): string {
  const rewards =
    result.citations.length > 0
      ? result.citations
          .map((citation) => `- ${citation.source}: $${citation.rewardPlannedUsdc.toFixed(4)} USDC`)
          .join("\n")
      : "- No source reward was allocated.";
  const settlement =
    result.paymentMode === "real"
      ? `${result.settledPayments}/${result.paymentAttempts} payment attempts settled`
      : result.paymentMode === "offline" ? "offline payment simulation" : "payment mode unknown; no simulation or settlement inferred";
  const selection = result.reasoning.sourceSelection;
  const engines = selection.servingEngines.slice(0, 4).join(", ") || "none recorded";
  const engineRemainder = selection.servingEngines.length > 4 ? ` + ${selection.servingEngines.length - 4} more` : "";
  const selectionText = `Recorded source selection: ${selection.state} · ${engines}${engineRemainder} · ` +
    (selection.fallbackUsed === true ? "fallback served" : selection.fallbackUsed === false ? "requested tier served" : "fallback use unknown") +
    ` (${result.reasoning.telemetry} attempt telemetry)`;
  const groundedClaims = result.claimCoverage.filter(
    (claim) => claim.coverage >= 0.4,
  ).length;

  return (
    `${result.answer}\n\n` +
    `${reasoningServingText(result)}\n\n` +
    `Citations and planned creator rewards\n${rewards}\n\n` +
    `Evidence: ${groundedClaims}/${result.claimCoverage.length} research targets meet the recorded excerpt-support threshold; this does not verify entailment or complete synthesis\n` +
    `${selectionText}\n` +
    `Total recorded to creators: $${result.totalToCreatorsUsdc.toFixed(4)} USDC · ${settlement}\n` +
    `Confidence: ${result.confidence?.level ?? "Low"} · ${result.dispatchUrl}`
  );
}

/** Build one stateless MCP server per HTTP request. The request's verified access stays in closure. */
export function createRemoteMcpServer(
  access: RemoteMcpAccess,
  runResearch: ResearchRunner = collectRun,
): McpServer {
  const server = new McpServer({
    name: "keryx",
    version: "0.3.1",
    description:
      "Budgeted research over creator sources with citation rewards on the configured Arc network. Anonymous research is sponsored by Keryx's treasury.",
  });

  server.registerTool(
    "research",
    {
      title: "Research with Keryx",
      description:
        "Research a question under a USDC creator-payment budget. Keryx selects sources, pays " +
        "access tolls and weighted citation rewards on the configured Arc network, then returns qualified source excerpts and a receipt. Complete synthesis and per-assertion entailment remain unverified. This remote surface uses Keryx's treasury; anonymous research is sponsored, not caller-funded usage. Public research may send your question to our search provider. The source USDC budget is separate from model and search operating costs.",
      inputSchema: {
        question: z.string().trim().min(3).max(4_000).describe("Research question."),
        budget: z
          .number()
          .nonnegative()
          .optional()
          .describe("Maximum creator-payment budget in USDC; 0 allows free sources without purchases or rewards. Clamped to the caller's tier."),
        scholarly: z.boolean().optional().describe("Opt in to bounded Crossref/arXiv paper discovery; sends the question to those providers."),
        mode: z.enum(["quick", "deep"]).optional().describe("Research depth; default deep."),
        model: z
          .string()
          .optional()
          .describe("Optional Keryx model catalog id, for example deepseek-chat."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ question, budget, model, scholarly, mode }) => {
      try {
        const requested =
          typeof budget === "number" && Number.isFinite(budget) && budget >= 0
            ? budget
            : config.defaultBudget;
        const modelChoice = resolveModelChoice(model);
        const run = await runResearch({
          question,
          budget: Math.min(requested, access.budgetCap),
          queryId: crypto.randomUUID(),
          origin: "mcp",
          scholarly: scholarly === true, researchMode: mode ?? "deep",
          mcpClient: access.clientChannel,
          ...(access.actor ? { asker: access.actor } : {}),
          ...(modelChoice ? { model: modelChoice.id } : {}),
        });
        const result = remoteResearchResult(run);
        return {
          content: [{ type: "text" as const, text: researchText(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Keryx research failed: ${message}` }],
        };
      }
    },
  );

  server.registerTool(
    "keryx_status",
    {
      title: "Keryx remote MCP status",
      description: "Describe this MCP surface, its payment behavior, and the active caller tier.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text:
            `Keryx Remote MCP is ready. Research calls are treasury-funded and creators receive ` +
            `real Arc USDC when settlement is configured. Budget cap: $${access.budgetCap} USDC. ` +
            `Caller: ${access.actor ? "verified API-key wallet" : "anonymous free trial"}.`,
        },
      ],
    }),
  );

  registerMonthlyDiscovery(server, async () => process.env.KERYX_MONTHLY_ENABLED === "1" ? quoteResearchMonthly() : null);
  return server;
}
