import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { collectRun } from "../agent";
import { config } from "../config";
import { resolveModelChoice } from "../llm";
import type { McpClientChannel, QueryRun } from "../types";

export interface RemoteMcpAccess {
  budgetCap: number;
  /** Wallet from a verified Keryx API key. Anonymous MCP clients leave this absent. */
  actor?: string;
  /** Self-declared setup URL channel. Telemetry only; never identity or payment authority. */
  clientChannel: McpClientChannel;
}

type ResearchRunner = typeof collectRun;

export function remoteResearchResult(run: QueryRun) {
  return {
    queryId: run.id,
    answer: run.answer,
    citations: run.citations.map((citation) => ({
      sourceId: citation.sourceId,
      source: citation.sourceName,
      weight: citation.weight,
      rewardUsdc: citation.reward,
    })),
    evidence: (run.evidence ?? [])
      .filter((item) => item.qualifiesForReward)
      .map((item) => ({
        claimIndex: item.claimIndex,
        claim: item.claim,
        source: item.sourceName,
        marker: item.marker,
        quote: item.quote,
        support: item.support,
      })),
    claimCoverage: run.claimCoverage ?? [],
    totalToCreatorsUsdc: run.totalToCreators,
    confidence: run.confidence,
    engine: run.engine,
    paymentMode: run.paymentMode,
    paymentAttempts: run.paymentAttempts ?? 0,
    settledPayments: run.settledPayments ?? 0,
    dispatchUrl: `${config.baseUrl}/dispatch/${run.id}`,
  };
}

function researchText(result: ReturnType<typeof remoteResearchResult>): string {
  const rewards =
    result.citations.length > 0
      ? result.citations
          .map((citation) => `- ${citation.source}: $${citation.rewardUsdc.toFixed(4)} USDC`)
          .join("\n")
      : "- No source reward was allocated.";
  const settlement =
    result.paymentMode === "real"
      ? `${result.settledPayments}/${result.paymentAttempts} payment attempts settled`
      : "offline payment simulation";
  const groundedClaims = result.claimCoverage.filter(
    (claim) => claim.coverage >= 0.4,
  ).length;

  return (
    `${result.answer}\n\n` +
    `Creator rewards\n${rewards}\n\n` +
    `Evidence: ${groundedClaims}/${result.claimCoverage.length} claims passed the grounding threshold\n` +
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
    version: "0.2.0",
    description:
      "Budgeted research over creator sources with citation rewards settled in USDC on Arc.",
  });

  server.registerTool(
    "research",
    {
      title: "Research with Keryx",
      description:
        "Research a question under a USDC creator-payment budget. Keryx selects sources, pays " +
        "access tolls and weighted citation rewards, then returns a grounded answer and receipt.",
      inputSchema: {
        question: z.string().trim().min(3).max(4_000).describe("Research question."),
        budget: z
          .number()
          .positive()
          .optional()
          .describe("Maximum creator-payment budget in USDC; clamped to the caller's tier."),
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
    async ({ question, budget, model }) => {
      try {
        const requested =
          typeof budget === "number" && Number.isFinite(budget) && budget > 0
            ? budget
            : config.defaultBudget;
        const modelChoice = resolveModelChoice(model);
        const run = await runResearch({
          question,
          budget: Math.min(requested, access.budgetCap),
          queryId: crypto.randomUUID(),
          origin: "mcp",
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

  return server;
}
